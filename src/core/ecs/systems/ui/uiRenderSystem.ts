// src/core/ecs/systems/ui/uiRenderSystem.ts
import { World } from "@/core/ecs/world";
import { Shader } from "@/core/shaders/shader";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import shaderUrl from "@/core/shaders/ui.wgsl?url";
import { UITransformComponent } from "@/core/ecs/components/ui/uiTransformComponent";
import {
  UIRectComponent,
  UIImageComponent,
  UITextComponent,
} from "@/core/ecs/components/ui/uiRenderComponent";
import { ResourceCacheComponent } from "@/core/ecs/components/resources/resourceCacheComponent";
import { UITextureFactory } from "@/core/resources/uiTextureFactory";

interface UIInstance {
  rect: { x: number; y: number; w: number; h: number };
  color: number[];
  uvRect: number[];
  params: number[]; // borderRadius, rotation, borderWidth, textureIndex
  texture?: GPUTexture;
}

/**
 * System responsible for querying UI components, preparing render data, and
 * executing the UI render pass.
 * @remarks
 * This system runs after the main 3D scene has been rendered. It queries the
 * ECS `World` for all UI entities, sorts them by z-index, resolves texture
 * resources from the cache, and batches them into instanced draw calls.
 */
export class UIRenderSystem {
  private device: GPUDevice;
  private preprocessor: ShaderPreprocessor;
  private pipeline!: GPURenderPipeline;
  private quadVertexBuffer!: GPUBuffer;
  private instanceBuffer!: GPUBuffer;
  private instanceCapacity = 100;
  private screenUniformBuffer!: GPUBuffer;
  private textureBindGroupLayout!: GPUBindGroupLayout;
  private canvasFormat: GPUTextureFormat;
  private defaultSampler!: GPUSampler;

  constructor(
    device: GPUDevice,
    preprocessor: ShaderPreprocessor,
    canvasFormat: GPUTextureFormat,
  ) {
    this.device = device;
    this.preprocessor = preprocessor;
    this.canvasFormat = canvasFormat;
  }

  public async init(): Promise<void> {
    const quadVertices = new Float32Array([
      -0.5, -0.5, 0, 0, 0.5, -0.5, 1, 0, 0.5, 0.5, 1, 1, -0.5, -0.5, 0, 0, 0.5,
      0.5, 1, 1, -0.5, 0.5, 0, 1,
    ]);
    this.quadVertexBuffer = this.device.createBuffer({
      label: "UI_QUAD_VERTEX_BUFFER",
      size: quadVertices.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.quadVertexBuffer.getMappedRange()).set(quadVertices);
    this.quadVertexBuffer.unmap();

    this.instanceBuffer = this.device.createBuffer({
      label: "UI_INSTANCE_BUFFER",
      size: this.instanceCapacity * 64,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.screenUniformBuffer = this.device.createBuffer({
      label: "UI_SCREEN_UNIFORM",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shader = await Shader.fromUrl(
      this.device,
      this.preprocessor,
      shaderUrl,
      "UI_SHADER",
    );

    this.textureBindGroupLayout = this.device.createBindGroupLayout({
      label: "UI_TEXTURE_BIND_GROUP_LAYOUT",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: "UI_PIPELINE_LAYOUT",
      bindGroupLayouts: [this.textureBindGroupLayout],
    });
    this.pipeline = await this.device.createRenderPipelineAsync({
      label: "UI_PIPELINE",
      layout: pipelineLayout,
      vertex: {
        module: shader.module,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32x2" },
            ],
          },
          {
            arrayStride: 64,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 2, offset: 0, format: "float32x4" },
              { shaderLocation: 3, offset: 16, format: "float32x4" },
              { shaderLocation: 4, offset: 32, format: "float32x4" },
              { shaderLocation: 5, offset: 48, format: "float32x4" },
            ],
          },
        ],
      },
      fragment: {
        module: shader.module,
        entryPoint: "fs_main",
        targets: [
          {
            format: this.canvasFormat,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
    });

    this.defaultSampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
  }

  public execute(
    world: World,
    commandEncoder: GPUCommandEncoder,
    canvasView: GPUTextureView,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    const cache = world.getOrAddResource(ResourceCacheComponent);

    const uiEntities = world.query([UITransformComponent]);
    if (uiEntities.length === 0) return;

    const sorted = uiEntities.sort((a, b) => {
      const ta = world.getComponent(a, UITransformComponent);
      const tb = world.getComponent(b, UITransformComponent);
      return (ta?.zIndex ?? 0) - (tb?.zIndex ?? 0);
    });

    const instances: UIInstance[] = [];
    for (const entity of sorted) {
      const transform = world.getComponent(entity, UITransformComponent);
      if (!transform) continue;

      const rect = world.getComponent(entity, UIRectComponent);
      if (rect) {
        instances.push({
          rect: transform.screenRect,
          color: Array.from(rect.color),
          uvRect: [0, 0, 1, 1],
          params: [rect.borderRadius, transform.rotation, rect.borderWidth, -1],
        });
      }

      const image = world.getComponent(entity, UIImageComponent);
      if (image?.textureHandle) {
        const uiTex = cache.getUITexture(image.textureHandle);
        if (uiTex) {
          instances.push({
            rect: transform.screenRect,
            color: Array.from(image.tint),
            uvRect: Array.from(image.uvRect),
            params: [0, transform.rotation, 0, 0],
            texture: uiTex.texture,
          });
        }
      }

      const text = world.getComponent(entity, UITextComponent);
      if (text?.text) {
        const textKey = UITextureFactory.generateTextCacheKey(text);
        let uiTex = cache.getUITexture(textKey);
        if (!uiTex) {
          uiTex = UITextureFactory.createFromText(this.device, text);
          cache.setUITexture(textKey, uiTex);
        }
        instances.push({
          rect: transform.screenRect,
          color: [1, 1, 1, 1],
          uvRect: [
            0,
            0,
            uiTex.width / uiTex.texture.width,
            uiTex.height / uiTex.texture.height,
          ],
          params: [0, transform.rotation, 0, 0],
          texture: uiTex.texture,
        });
      }
    }

    if (instances.length === 0) return;

    const passEncoder = commandEncoder.beginRenderPass({
      label: "UI_RENDER_PASS",
      colorAttachments: [
        { view: canvasView, loadOp: "load", storeOp: "store" },
      ],
    });

    passEncoder.setPipeline(this.pipeline);
    passEncoder.setVertexBuffer(0, this.quadVertexBuffer);

    const screenData = new Float32Array([canvasWidth, canvasHeight, 0, 0]);
    this.device.queue.writeBuffer(this.screenUniformBuffer, 0, screenData);

    // Batch by texture
    let firstInstance = 0;
    while (firstInstance < instances.length) {
      const firstInst = instances[firstInstance];
      const texture = firstInst.texture;
      let count = 1;
      while (
        firstInstance + count < instances.length &&
        instances[firstInstance + count].texture === texture
      ) {
        count++;
      }

      const batchInstances = instances.slice(
        firstInstance,
        firstInstance + count,
      );
      this.uploadInstances(batchInstances);

      const bindGroup = this.device.createBindGroup({
        layout: this.textureBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.screenUniformBuffer } },
          { binding: 1, resource: this.defaultSampler },
          {
            binding: 2,
            resource: (
              texture ??
              this.device.createTexture({
                size: [1, 1],
                format: "rgba8unorm",
                usage: GPUTextureUsage.TEXTURE_BINDING,
              })
            ).createView(),
          },
        ],
      });

      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.setVertexBuffer(
        1,
        this.instanceBuffer,
        0,
        batchInstances.length * 64,
      );
      passEncoder.draw(6, batchInstances.length, 0, 0);

      firstInstance += count;
    }

    passEncoder.end();
  }

  private uploadInstances(instances: UIInstance[]): void {
    if (instances.length > this.instanceCapacity) {
      this.instanceBuffer.destroy();
      this.instanceCapacity = Math.ceil(instances.length * 1.5);
      this.instanceBuffer = this.device.createBuffer({
        label: "UI_INSTANCE_BUFFER_RESIZED",
        size: this.instanceCapacity * 64,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }

    const data = new Float32Array(instances.length * 16);
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const base = i * 16;
      data.set([inst.rect.x, inst.rect.y, inst.rect.w, inst.rect.h], base);
      data.set(inst.color, base + 4);
      data.set(inst.uvRect, base + 8);
      data.set(inst.params, base + 12);
    }
    this.device.queue.writeBuffer(this.instanceBuffer, 0, data);
  }
}

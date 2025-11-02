// src/core/rendering/passes/uiPass.ts
import { RenderContext, RenderPass } from "@/core/types/rendering";
import { World } from "@/core/ecs/world";
import { UIResourceManager } from "@/core/resources/ui/uiResourceManager";
import { UITransformComponent } from "@/core/ecs/components/ui/uiTransformComponent";
import {
  UIRectComponent,
  UIImageComponent,
  UITextComponent,
} from "@/core/ecs/components/ui/uiRenderComponent";
import shaderUrl from "@/core/shaders/ui.wgsl?url";
import { Shader } from "@/core/shaders/shader";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";

interface UIInstance {
  rect: { x: number; y: number; w: number; h: number };
  color: number[];
  uvRect: number[];
  params: number[]; // borderRadius, rotation, borderWidth, textureIndex
}

/**
 * Renders UI elements on top of the completed scene.
 *
 * @remarks
 * This pass handles all 2D UI rendering using instanced draw calls. It supports
 * both ECS-based UI entities and custom drawing via callbacks. The pass uses
 * `loadOp: 'load'` to preserve the existing scene content and render UI on top.
 *
 * The pass supports:
 * - Solid color rectangles with border radius
 * - Textured images with tinting
 * - Canvas-rendered text
 * - Rotation and custom UV coordinates
 * - Custom drawing via callback (for debug UI, external UI libraries, etc.)
 */
export class UIPass implements RenderPass {
  private device: GPUDevice;
  private preprocessor: ShaderPreprocessor;
  private pipeline?: GPURenderPipeline;
  private quadVertexBuffer?: GPUBuffer;
  private instanceBuffer?: GPUBuffer;
  private instanceCapacity = 100;
  private screenUniformBuffer?: GPUBuffer;
  private textureBindGroup?: GPUBindGroup;
  private textureBindGroupLayout?: GPUBindGroupLayout;
  private canvasFormat: GPUTextureFormat;
  private uiResourceManager: UIResourceManager;

  // dependencies for ECS UI
  private world?: World;

  constructor(
    device: GPUDevice,
    preprocessor: ShaderPreprocessor,
    canvasFormat: GPUTextureFormat,
    uiResourceManager: UIResourceManager,
    world: World,
  ) {
    this.device = device;
    this.preprocessor = preprocessor;
    this.canvasFormat = canvasFormat;
    this.uiResourceManager = uiResourceManager;
    this.world = world;
  }

  /**
   * Initializes the UI rendering pipeline and resources.
   */
  public async init(): Promise<void> {
    // Create quad vertex buffer (two triangles)
    const quadVertices = new Float32Array([
      // pos(x,y)  uv(u,v)
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

    // Create instance buffer
    this.instanceBuffer = this.device.createBuffer({
      label: "UI_INSTANCE_BUFFER",
      size: this.instanceCapacity * 64, // 64 bytes per instance
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Create screen uniform buffer
    this.screenUniformBuffer = this.device.createBuffer({
      label: "UI_SCREEN_UNIFORM",
      size: 16, // vec2 + padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Load shader
    const shader = await Shader.fromUrl(
      this.device,
      this.preprocessor,
      shaderUrl,
      "UI_SHADER",
    );

    // Create bind group layout
    this.textureBindGroupLayout = this.device.createBindGroupLayout({
      label: "UI_TEXTURE_BIND_GROUP_LAYOUT",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {},
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      ],
    });

    // Create pipeline
    const pipelineLayout = this.device.createPipelineLayout({
      label: "UI_PIPELINE_LAYOUT",
      bindGroupLayouts: [this.textureBindGroupLayout],
    });

    this.pipeline = this.device.createRenderPipeline({
      label: "UI_PIPELINE",
      layout: pipelineLayout,
      vertex: {
        module: shader.module,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" }, // position
              { shaderLocation: 1, offset: 8, format: "float32x2" }, // uv
            ],
          },
          {
            arrayStride: 64,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 2, offset: 0, format: "float32x4" }, // rect
              { shaderLocation: 3, offset: 16, format: "float32x4" }, // color
              { shaderLocation: 4, offset: 32, format: "float32x4" }, // uvRect
              { shaderLocation: 5, offset: 48, format: "float32x4" }, // params
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
      primitive: {
        topology: "triangle-list",
        cullMode: "none",
      },
    });
  }

  /**
   * Executes the UI rendering pass.
   *
   * @remarks
   * This method matches the RenderPass interface signature. It:
   * 1. Begins a render pass with loadOp: 'load' to preserve scene content
   * 2. Renders ECS-based UI entities if configured
   * 3. Invokes the custom draw callback if set
   * 4. Ends the render pass
   *
   * The optional passEncoder parameter is ignored as this pass creates its own.
   *
   * @param context The render context for this frame
   */
  public execute(
    context: RenderContext,
    passEncoder?: GPURenderPassEncoder,
    callback?: (passEncoder: GPURenderPassEncoder) => void,
  ): void {
    // Begin render pass with loadOp: 'load' to preserve scene
    const uiPassEncoder = context.commandEncoder.beginRenderPass({
      label: "UI_RENDER_PASS",
      colorAttachments: [
        {
          view: context.canvasView,
          loadOp: "load",
          storeOp: "store",
        },
      ],
    });

    uiPassEncoder.setViewport(
      0,
      0,
      context.canvasWidth,
      context.canvasHeight,
      0,
      1,
    );

    // Render ECS-based UI
    if (this.world) {
      this.renderECSUI(
        context,
        this.world,
        this.uiResourceManager,
        uiPassEncoder,
      );
    }

    // Invoke callback for custom drawing (debug UI, external libraries, etc.)
    if (callback) {
      callback(uiPassEncoder);
    }

    uiPassEncoder.end();
  }

  /**
   * Renders UI entities from the ECS world.
   *
   * @remarks
   * This is an internal method that handles the ECS-based UI rendering.
   * It queries the world, collects instances, and records draw calls.
   */
  private renderECSUI(
    context: RenderContext,
    world: World,
    uiTextureManager: UIResourceManager,
    passEncoder: GPURenderPassEncoder,
  ): void {
    if (!this.pipeline) return;

    // Query and sort UI entities by z-index
    const uiEntities = world.query([UITransformComponent]);
    if (uiEntities.length === 0) return;

    const sorted = uiEntities.sort((a, b) => {
      const ta = world.getComponent(a, UITransformComponent);
      const tb = world.getComponent(b, UITransformComponent);
      if (ta && tb) {
        return ta.zIndex - tb.zIndex;
      } else {
        return 0;
      }
    });

    const instances: UIInstance[] = [];

    // Collect instances from UI components
    for (const entity of sorted) {
      const transform = world.getComponent(entity, UITransformComponent);
      const rect = world.getComponent(entity, UIRectComponent);
      const image = world.getComponent(entity, UIImageComponent);
      const text = world.getComponent(entity, UITextComponent);

      if (rect && transform) {
        instances.push({
          rect: transform.screenRect,
          color: Array.from(rect.color),
          uvRect: [0, 0, 1, 1],
          params: [rect.borderRadius, transform.rotation, rect.borderWidth, -1],
        });
      }

      if (image?.textureHandle && transform) {
        const uiTex = uiTextureManager.getTexture(image.textureHandle);
        if (uiTex) {
          instances.push({
            rect: transform.screenRect,
            color: Array.from(image.tint),
            uvRect: Array.from(image.uvRect),
            params: [0, transform.rotation, 0, 0],
          });
        }
      }

      if (text?.text && transform) {
        const uiTex = uiTextureManager.generateText(text);
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
        });
      }
    }

    if (instances.length === 0) return;

    // Upload instances
    this.uploadInstances(instances);

    // Update screen uniform
    const screenData = new Float32Array([
      context.canvasWidth,
      context.canvasHeight,
      0,
      0,
    ]);
    if (this.screenUniformBuffer) {
      this.device.queue.writeBuffer(this.screenUniformBuffer, 0, screenData);
    }

    // Create bind group with dummy texture
    // Todo: Support multiple textures or texture atlasing
    const dummyTexture = context.device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    const dummySampler = this.device.createSampler();

    if (this.textureBindGroupLayout && this.screenUniformBuffer) {
      this.textureBindGroup = this.device.createBindGroup({
        label: "UI_TEXTURE_BIND_GROUP",
        layout: this.textureBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.screenUniformBuffer } },
          { binding: 1, resource: dummySampler },
          { binding: 2, resource: dummyTexture.createView() },
        ],
      });
    }

    // Record draw calls
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.textureBindGroup);
    passEncoder.setVertexBuffer(0, this.quadVertexBuffer);
    passEncoder.setVertexBuffer(1, this.instanceBuffer);
    passEncoder.draw(6, instances.length, 0, 0);

    // Cleanup temporary resources
    dummyTexture.destroy();
  }

  private uploadInstances(instances: UIInstance[]): void {
    if (instances.length > this.instanceCapacity) {
      this.instanceBuffer?.destroy();
      this.instanceCapacity = Math.ceil(instances.length * 1.5);
      this.instanceBuffer = this.device.createBuffer({
        label: "UI_INSTANCE_BUFFER (resized)",
        size: this.instanceCapacity * 64,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }

    const data = new Float32Array(instances.length * 16);
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const base = i * 16;
      data[base + 0] = inst.rect.x;
      data[base + 1] = inst.rect.y;
      data[base + 2] = inst.rect.w;
      data[base + 3] = inst.rect.h;
      data.set(inst.color, base + 4);
      data.set(inst.uvRect, base + 8);
      data.set(inst.params, base + 12);
    }

    if (this.instanceBuffer) {
      this.device.queue.writeBuffer(this.instanceBuffer, 0, data);
    }
  }
}

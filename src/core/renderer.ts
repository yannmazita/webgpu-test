// src/core/renderer.ts
import shaderCode from "@/core/shaders/shaders.wgsl";
import { createShaderModule } from "@/core/utils/webgpu";
import { getLayoutKey } from "@/core/utils/layout";
import { Camera } from "@/core/camera";
import { Scene } from "@/core/scene";
import { mat4, Mat4, vec3 } from "wgpu-matrix";
import { Mesh, Renderable } from "./types/gpu";

/**
 * The central rendering engine.
 *
 * This class manages the `GPUDevice`, canvas context, shader modules,
 * render pipelines, and buffers. It orchestrates the entire rendering
 * process each frame, from setting up resources to submitting commands to the
 * GPU.
 */
export class Renderer {
  /** The primary WebGPU device used for all GPU operations. */
  public device!: GPUDevice;

  // Internal state management
  /** The HTML canvas element to which the renderer will draw. */
  private canvas: HTMLCanvasElement;
  /** The GPU-enabled context of the canvas. */
  private context!: GPUCanvasContext;
  /** The GPU adapter, representing a physical GPU. */
  private adapter!: GPUAdapter;
  /** A cache for render pipelines, keyed by vertex buffer layout. */
  private pipelines = new Map<string, GPURenderPipeline>();
  /** The compiled WGSL shader module. */
  private shaderModule!: GPUShaderModule;
  /** A shared buffer for per-instance data, primarily model matrices. */
  private instanceBuffer!: GPUBuffer;
  /** A depth texture to store depth information of fragments. */
  private depthTexture!: GPUTexture;
  /** The layout for the entire pipeline, defining all bind groups. */
  private pipelineLayout!: GPUPipelineLayout;

  /** The layout for bind group 0 or per-frame data (camera, scene). */
  private frameBindGroupLayout!: GPUBindGroupLayout;
  /** The bind group for per-frame data. */
  private frameBindGroup!: GPUBindGroup;
  /** Uniform buffer for the camera's view-projection matrix. */
  private cameraUniformBuffer!: GPUBuffer;
  /** Uniform buffer for scene-wide data like lighting and camera position. */
  private sceneUniformsBuffer!: GPUBuffer;

  /** The layout for bind group 1, used for per-object/material data. */
  private materialBindGroupLayout!: GPUBindGroupLayout;

  // Constants
  private static readonly MATRIX_BYTE_SIZE =
    4 * 4 * Float32Array.BYTES_PER_ELEMENT; // 4x4 matrix of 4 bytes = 64 bytes

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /**
   * Initializes the WebGPU device, context, shaders, and essential buffers.
   * This method must be called before any rendering or resource creation.
   */
  public async init(): Promise<void> {
    await this.setupDevice();
    this.setupContext();
    this.createDepthTexture();
    this.shaderModule = createShaderModule(this.device, shaderCode);

    const MATRIX_SIZE = 4 * 4 * Float32Array.BYTES_PER_ELEMENT;
    this.cameraUniformBuffer = this.device.createBuffer({
      label: "CAMERA_UNIFORM_BUFFER",
      size: MATRIX_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Scene uniforms buffer: lightPos (vec3), lightColor (vec3), cameraPos (vec3)
    // Using vec4 alignment: 3*vec4 = 3 * 16 = 48 bytes
    const SCENE_UNIFORMS_SIZE = 3 * 4 * Float32Array.BYTES_PER_ELEMENT;
    this.sceneUniformsBuffer = this.device.createBuffer({
      label: "SCENE_UNIFORMS_BUFFER",
      size: SCENE_UNIFORMS_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    /**
     * Layout for @group(0), containing per-frame scene data.
     */
    this.frameBindGroupLayout = this.device.createBindGroupLayout({
      label: "FRAME_BIND_GROUP_LAYOUT",
      entries: [
        {
          binding: 0, // Camera Uniform Buffer (View/Projection Matrix)
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
        {
          binding: 1, // Scene Uniforms (light, camera position)
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.frameBindGroup = this.device.createBindGroup({
      label: "FRAME_BIND_GROUP",
      layout: this.frameBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniformBuffer } },
        { binding: 1, resource: { buffer: this.sceneUniformsBuffer } },
      ],
    });

    /**
     * Layout for @group(1), containing per-material data.
     * Corresponds to the material textures/samplers in shaders.wgsl.
     */
    this.materialBindGroupLayout = this.device.createBindGroupLayout({
      label: "MATERIAL_BIND_GROUP_LAYOUT",
      entries: [
        {
          binding: 0, // Texture View
          visibility: GPUShaderStage.FRAGMENT,
          texture: {},
        },
        {
          binding: 1, // Sampler
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {},
        },
        {
          binding: 2, // Material Uniforms (baseColor, flags)
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    // The pipeline layout defines the full set of bind groups used by a pipeline.
    this.pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        this.frameBindGroupLayout, // This is @group(0)
        this.materialBindGroupLayout, // This is @group(1)
      ],
    });
  }

  /**
   * Checks for WebGPU support and acquires the GPU device and adapter.
   */
  private async setupDevice(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error("WebGPU is not supported by this browser.");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("Failed to get GPU adapter.");
    }
    this.adapter = adapter;

    this.device = await this.adapter.requestDevice();
  }

  /**
   * Configures the canvas context for rendering.
   */
  private setupContext(): void {
    this.context = this.canvas.getContext("webgpu") as GPUCanvasContext;
    const canvasConfig: GPUCanvasConfiguration = {
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: "premultiplied",
    };
    this.context.configure(canvasConfig);
  }

  /**
   * Creates the depth texture for the renderer.
   * This texture is used for depth testing to ensure objects are drawn in the
   * correct order. It must be recreated if the canvas is resized.
   */
  private createDepthTexture(): void {
    this.depthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height, 1], // 1 array layer (single texture)
      dimension: "2d",
      format: "depth24plus-stencil8", // same as the depthStencil in the pipeline
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  /**
   * Handles canvas resizing in the renderer.
   *
   * This method destoys and recreates the depth texture.
   */
  public resizeCanvas(): void {
    this.depthTexture.destroy();
    this.createDepthTexture();
  }

  /**
   * Retrieves a cached pipeline for the given layouts or creates a new one.
   * Caching pipelines is a critical optimization as pipeline creation is expensive.
   * @param layouts - Array of vertex buffer layouts for the mesh to be rendered.
   * @param isTransparent - Has the material alpha blending enabled
   * @returns A GPURenderPipeline configured for the given layout.
   */
  private getOrCreatePipeline(
    layouts: GPUVertexBufferLayout[],
    isTransparent: boolean,
  ): GPURenderPipeline {
    const layoutKey = getLayoutKey(layouts);
    const finalKey = layoutKey + (isTransparent ? ":transparent" : ":opaque");

    if (this.pipelines.has(finalKey)) {
      return this.pipelines.get(finalKey)!;
    }

    // Define the layout for the per-instance data buffer.
    const instanceDataLayout: GPUVertexBufferLayout = {
      // The stride is for two 4x4 matrices.
      arrayStride: Renderer.MATRIX_BYTE_SIZE * 2,
      stepMode: "instance",
      // Passing the model and normal matrices as 4 vec4 attributes each
      // (because they're too big to pass through a single location)
      attributes: [
        // Model Matrix (locations 3-6)
        { shaderLocation: 3, offset: 0, format: "float32x4" },
        { shaderLocation: 4, offset: 16, format: "float32x4" },
        { shaderLocation: 5, offset: 32, format: "float32x4" },
        { shaderLocation: 6, offset: 48, format: "float32x4" },
        // Normal Matrix (locations 7-10)
        { shaderLocation: 7, offset: 64, format: "float32x4" },
        { shaderLocation: 8, offset: 80, format: "float32x4" },
        { shaderLocation: 9, offset: 96, format: "float32x4" },
        { shaderLocation: 10, offset: 112, format: "float32x4" },
      ],
    };

    // If not, create a new pipeline.
    const newPipeline = this.device.createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: {
        module: this.shaderModule,
        entryPoint: "vs_main",
        buffers: [...layouts, instanceDataLayout], // Pass all the layouts
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat(),
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
        frontFace: "ccw",
        // use none to disable culling of back-facing faces and color them
        // in the shader
        cullMode: "back",
      },
      depthStencil: {
        // Transparent objects test against the depth buffer but don't write to it.
        depthWriteEnabled: !isTransparent,
        depthCompare: "less",
        format: "depth24plus-stencil8",
      },
    });

    // Cache the new pipeline for future use.
    this.pipelines.set(finalKey, newPipeline);
    return newPipeline;
  }

  /**
   * Renders a given `Scene` from the perspective of a `Camera`.
   * @param camera The camera providing the view and projection matrices.
   * @param scene The scene containing the list of objects to render.
   */
  public render(camera: Camera, scene: Scene): void {
    // 1. Update camera uniform buffer
    this.device.queue.writeBuffer(
      this.cameraUniformBuffer,
      0,
      camera.viewProjectionMatrix as Float32Array,
    );

    // 2. Update scene uniforms buffer
    const sceneUniformsData = new Float32Array(12);
    sceneUniformsData.set(scene.light.position, 0); // vec3 lightPos
    sceneUniformsData.set(scene.light.color, 4); // vec3 lightColor
    sceneUniformsData.set(camera.position, 8); // vec3 cameraPos
    this.device.queue.writeBuffer(
      this.sceneUniformsBuffer,
      0,
      sceneUniformsData,
    );

    // 3. Partition objects into opaque and transparent lists
    const opaqueRenderables: Renderable[] = [];
    const transparentRenderables: Renderable[] = [];
    for (const renderable of scene.objects) {
      if (renderable.material.isTransparent) {
        transparentRenderables.push(renderable);
      } else {
        opaqueRenderables.push(renderable);
      }
    }

    // 4. Prepare instance data for both lists
    const totalInstanceCount = scene.objects.length;
    const requiredBufferSize =
      totalInstanceCount * Renderer.MATRIX_BYTE_SIZE * 2;

    if (!this.instanceBuffer || this.instanceBuffer.size < requiredBufferSize) {
      if (this.instanceBuffer) this.instanceBuffer.destroy();
      const newSize = Math.ceil(requiredBufferSize * 1.5);
      this.instanceBuffer = this.device.createBuffer({
        label: "INSTANCE_MODEL_MATRIX_BUFFER",
        size: newSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.1, g: 0.1, b: 0.15, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
        stencilClearValue: 0,
        stencilLoadOp: "clear",
        stencilStoreOp: "store",
      },
    });

    passEncoder.setViewport(0, 0, this.canvas.width, this.canvas.height, 0, 1);
    passEncoder.setBindGroup(0, this.frameBindGroup);

    let instanceBufferOffset = 0;

    // 5. Opaque rendering pass (using high-performance batching)
    if (opaqueRenderables.length > 0) {
      const batches = new Map<GPUBindGroup, Map<Mesh, Mat4[]>>();
      for (const renderable of opaqueRenderables) {
        const { mesh, material, modelMatrix } = renderable;
        if (!batches.has(material.bindGroup)) {
          batches.set(material.bindGroup, new Map<Mesh, Mat4[]>());
        }
        const materialBatch = batches.get(material.bindGroup)!;
        if (!materialBatch.has(mesh)) {
          materialBatch.set(mesh, []);
        }
        materialBatch.get(mesh)!.push(modelMatrix);
      }

      for (const [materialBindGroup, meshMap] of batches.entries()) {
        passEncoder.setBindGroup(1, materialBindGroup);
        for (const [mesh, modelMatrices] of meshMap.entries()) {
          const pipeline = this.getOrCreatePipeline(mesh.layouts, false);
          passEncoder.setPipeline(pipeline);

          const instanceCount = modelMatrices.length;
          const instanceData = new Float32Array(instanceCount * 32);
          const normalMatrix = mat4.create();
          for (let i = 0; i < instanceCount; i++) {
            const modelMatrix = modelMatrices[i];
            instanceData.set(modelMatrix, i * 32);
            mat4.invert(modelMatrix, normalMatrix);
            mat4.transpose(normalMatrix, normalMatrix);
            instanceData.set(normalMatrix, i * 32 + 16);
          }

          const batchByteLength = instanceData.byteLength;
          this.device.queue.writeBuffer(
            this.instanceBuffer,
            instanceBufferOffset,
            instanceData,
          );

          for (let i = 0; i < mesh.buffers.length; i++) {
            passEncoder.setVertexBuffer(i, mesh.buffers[i]);
          }
          passEncoder.setVertexBuffer(
            mesh.buffers.length,
            this.instanceBuffer,
            instanceBufferOffset,
            batchByteLength,
          );

          if (mesh.indexBuffer && mesh.indexFormat && mesh.indexCount) {
            passEncoder.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat);
            passEncoder.drawIndexed(mesh.indexCount, instanceCount, 0, 0, 0);
          } else {
            passEncoder.draw(mesh.vertexCount, instanceCount, 0, 0);
          }
          instanceBufferOffset += batchByteLength;
        }
      }
    }

    // 6. Transparent rendering pass (sort back-to-front and render individually)
    if (transparentRenderables.length > 0) {
      // Sort transparent objects from furthest to nearest
      transparentRenderables.sort((a, b) => {
        const posA = vec3.fromValues(
          a.modelMatrix[12],
          a.modelMatrix[13],
          a.modelMatrix[14],
        );
        const posB = vec3.fromValues(
          b.modelMatrix[12],
          b.modelMatrix[13],
          b.modelMatrix[14],
        );
        const distA = vec3.distanceSq(posA, camera.position);
        const distB = vec3.distanceSq(posB, camera.position);
        return distB - distA; // Sort descending by distance
      });

      // Prepare instance data for all transparent objects in one go
      const transparentInstanceData = new Float32Array(
        transparentRenderables.length * 32,
      );
      const normalMatrix = mat4.create();
      for (let i = 0; i < transparentRenderables.length; i++) {
        const { modelMatrix } = transparentRenderables[i];
        transparentInstanceData.set(modelMatrix, i * 32);
        mat4.invert(modelMatrix, normalMatrix);
        mat4.transpose(normalMatrix, normalMatrix);
        transparentInstanceData.set(normalMatrix, i * 32 + 16);
      }
      this.device.queue.writeBuffer(
        this.instanceBuffer,
        instanceBufferOffset,
        transparentInstanceData,
      );

      // Render sorted transparent objects
      let lastMaterial: null | GPUBindGroup = null;
      let lastMesh: null | Mesh = null;
      for (let i = 0; i < transparentRenderables.length; i++) {
        const { mesh, material } = transparentRenderables[i];

        // Minimize state changes
        if (material.bindGroup !== lastMaterial) {
          passEncoder.setBindGroup(1, material.bindGroup);
          lastMaterial = material.bindGroup;
        }
        if (mesh !== lastMesh) {
          const pipeline = this.getOrCreatePipeline(mesh.layouts, true);
          passEncoder.setPipeline(pipeline);

          for (let j = 0; j < mesh.buffers.length; j++) {
            passEncoder.setVertexBuffer(j, mesh.buffers[j]);
          }
          passEncoder.setVertexBuffer(
            mesh.buffers.length,
            this.instanceBuffer,
            instanceBufferOffset,
            transparentInstanceData.byteLength,
          );
          if (mesh.indexBuffer) {
            passEncoder.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat!);
          }
          lastMesh = mesh;
        }

        // Draw this single instance, using 'i' as the firstInstance offset
        if (mesh.indexBuffer && mesh.indexCount) {
          passEncoder.drawIndexed(mesh.indexCount, 1, 0, 0, i);
        } else {
          passEncoder.draw(mesh.vertexCount, 1, 0, i);
        }
      }
    }

    passEncoder.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Gets the frame bind group layout.
   * This is needed by external systems if they were to create compatible bind groups.
   */
  public getFrameBindGroupLayout(): GPUBindGroupLayout {
    if (!this.frameBindGroupLayout) {
      throw new Error(
        "Frame bind group layout is not initialized. Call init() first.",
      );
    }
    return this.frameBindGroupLayout;
  }

  /**
   * Gets the bind group layout for materials.
   * Needed by the `ResourceManager` to create compatible material bind groups.
   * @returns The material's `GPUBindGroupLayout`.
   */
  public getMaterialBindGroupLayout(): GPUBindGroupLayout {
    if (!this.materialBindGroupLayout) {
      throw new Error(
        "Material bind group layout is not initialized. Call init() first.",
      );
    }
    return this.materialBindGroupLayout;
  }
}

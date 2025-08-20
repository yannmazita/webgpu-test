// src/core/renderer.ts
import shaderCode from "@/core/shaders/shaders.wgsl";
import { createShaderModule } from "@/core/utils/webgpu";
import { getLayoutKey } from "@/core/utils/layout";
import { Camera } from "@/core/camera";
import { Scene } from "@/core/scene";
import { mat4, Mat4 } from "wgpu-matrix";
import { Mesh } from "./types/gpu";

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
  /** The layout for bind group 0, used for per-frame data like the camera. */
  private cameraBindGroupLayout!: GPUBindGroupLayout;
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

    /**
     * Layout for @group(0), containing per-frame scene data like the camera.
     * Corresponds to the Camera struct in shaders.wgsl.
     */
    this.cameraBindGroupLayout = this.device.createBindGroupLayout({
      label: "CAMERA_BIND_GROUP_LAYOUT",
      entries: [
        {
          binding: 0, // Camera Uniform Buffer
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
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
        this.cameraBindGroupLayout, // This is @group(0)
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
      alphaMode: "opaque",
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
   * @returns A GPURenderPipeline configured for the given layout.
   */
  private getOrCreatePipeline(
    layouts: GPUVertexBufferLayout[],
  ): GPURenderPipeline {
    const layoutKey = getLayoutKey(layouts);
    if (this.pipelines.has(layoutKey)) {
      return this.pipelines.get(layoutKey)!;
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
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
      },
      primitive: {
        topology: "triangle-list",
        frontFace: "ccw",
        // using none to disable culling of back-facing faces and color them
        // in the shader
        cullMode: "none",
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: "less",
        format: "depth24plus-stencil8",
      },
    });

    // Cache the new pipeline for future use.
    this.pipelines.set(layoutKey, newPipeline);
    return newPipeline;
  }

  /**
   * Renders a given `Scene` from the perspective of a `Camera`.
   * @param camera The camera providing the view and projection matrices.
   * @param scene The scene containing the list of objects to render.
   */
  public render(camera: Camera, scene: Scene): void {
    // Update the GPU buffer of the camera once per frame.
    camera.writeToGpu(this.device.queue);

    // Group renderable objects by mesh and material to enable instancing.
    // We use a Map where the key is the material's bind group, and the value
    // is another Map where the key is the mesh and value is the list of matrices.
    const batches = new Map<GPUBindGroup, Map<Mesh, Mat4[]>>();

    for (const renderable of scene.objects) {
      const { mesh, material, modelMatrix } = renderable;

      if (!batches.has(material.bindGroup)) {
        batches.set(material.bindGroup, new Map<Mesh, Mat4[]>());
      }
      const materialBatch = batches.get(material.bindGroup)!;

      if (!materialBatch.has(mesh)) {
        materialBatch.set(mesh, []);
      }
      const meshBatch = materialBatch.get(mesh)!;
      meshBatch.push(modelMatrix);
    }

    let totalInstanceCount = 0;
    for (const meshMap of batches.values()) {
      for (const matrices of meshMap.values()) {
        totalInstanceCount += matrices.length;
      }
    }

    // required buffer size is doubled for each instance (because model and normal matrices)
    const requiredBufferSize =
      totalInstanceCount * Renderer.MATRIX_BYTE_SIZE * 2;

    if (!this.instanceBuffer || this.instanceBuffer.size < requiredBufferSize) {
      if (this.instanceBuffer) {
        this.instanceBuffer.destroy();
      }
      // Allocate 50% more space to avoid reallocating every frame
      // on minor object count changes.
      const newSize = Math.ceil(requiredBufferSize * 1.5);
      this.instanceBuffer = this.device.createBuffer({
        label: "INSTANCE_MODEL_MATRIX_BUFFER",
        size: newSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }

    const textureView = this.context.getCurrentTexture().createView();
    const commandEncoder = this.device.createCommandEncoder();

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

    // Set the camera bind group once for the entire render pass.
    passEncoder.setBindGroup(0, camera.bindGroup);

    // Keep track of the current offset into the instance buffer.
    let instanceDataOffset = 0;

    // Iterate over the batched objects and draw them using instancing.
    for (const [materialBindGroup, meshMap] of batches.entries()) {
      passEncoder.setBindGroup(1, materialBindGroup);

      for (const [mesh, modelMatrices] of meshMap.entries()) {
        // Pass the array of layouts for the mesh
        const pipeline = this.getOrCreatePipeline(mesh.layouts);
        passEncoder.setPipeline(pipeline);

        // Prepare instance data
        const instanceCount = modelMatrices.length;
        const instanceData = new Float32Array(instanceCount * 32); // 2 * 16
        const normalMatrix = mat4.create();

        for (let i = 0; i < instanceCount; i++) {
          const modelMatrix = modelMatrices[i];
          // Write model matrix at the start of the instance data block
          instanceData.set(modelMatrix, i * 32);

          // Calculate and write the normal matrix
          mat4.invert(modelMatrix, normalMatrix);
          mat4.transpose(normalMatrix, normalMatrix);

          // Write normal matrix after the model matrix
          instanceData.set(normalMatrix, i * 32 + 16);
        }

        const batchByteLength = instanceData.byteLength;

        this.device.queue.writeBuffer(
          this.instanceBuffer,
          instanceDataOffset,
          instanceData,
        );

        // Set the vertex buffers for the mesh attributes (pos, normal, uv)
        for (let i = 0; i < mesh.buffers.length; i++) {
          passEncoder.setVertexBuffer(i, mesh.buffers[i]);
        }

        // Set the instance data buffer at the next available slot
        passEncoder.setVertexBuffer(
          mesh.buffers.length,
          this.instanceBuffer,
          instanceDataOffset,
          batchByteLength,
        );

        // Draw all instances in a single call.
        // Use drawIndexed if an index buffer is available, otherwise use draw.
        if (mesh.indexBuffer && mesh.indexFormat && mesh.indexCount) {
          passEncoder.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat);
          passEncoder.drawIndexed(mesh.indexCount, instanceCount, 0, 0, 0);
        } else {
          passEncoder.draw(mesh.vertexCount, instanceCount, 0, 0);
        }

        // Increment the offset for the next batch.
        instanceDataOffset += batchByteLength;
      }
    }

    passEncoder.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Gets the camera bind group layout.
   * This is needed to initialize the camera object from outside the renderer.
   */
  public getCameraBindGroupLayout(): GPUBindGroupLayout {
    if (!this.cameraBindGroupLayout) {
      throw new Error(
        "Camera bind group layout is not initialized. Call init() first.",
      );
    }
    return this.cameraBindGroupLayout;
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

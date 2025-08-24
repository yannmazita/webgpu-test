// src/core/renderer.ts
import { Camera } from "@/core/camera";
import { Scene } from "@/core/scene";
import { mat4, Mat4, vec3 } from "wgpu-matrix";
import { Mesh, PipelineBatch, Renderable } from "./types/gpu";
import { Material } from "./materials/material";

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
  /** The format of the canvas texture. */
  public canvasFormat!: GPUTextureFormat;
  /** The format of the depth texture. */
  public depthFormat!: GPUTextureFormat;

  // Internal state management
  /** The HTML canvas element to which the renderer will draw. */
  private canvas: HTMLCanvasElement;
  /** The GPU-enabled context of the canvas. */
  private context!: GPUCanvasContext;
  /** The GPU adapter, representing a physical GPU. */
  private adapter!: GPUAdapter;
  /** A shared buffer for per-instance data, primarily model matrices. */
  private instanceBuffer!: GPUBuffer;
  /** A depth texture to store depth information of fragments. */
  private depthTexture!: GPUTexture;

  /** The layout for bind group 0 or per-frame data (camera, scene). */
  private frameBindGroupLayout!: GPUBindGroupLayout;
  /** The bind group for per-frame data. */
  private frameBindGroup!: GPUBindGroup;
  /** Uniform buffer for the camera's view-projection matrix. */
  private cameraUniformBuffer!: GPUBuffer;
  /** Uniform buffer for scene-wide data (camera position). */
  private sceneDataBuffer!: GPUBuffer;
  /** Storage buffer for all light data. */
  private lightStorageBuffer!: GPUBuffer;
  /** A temporary buffer for writing light data. */
  private lightDataBuffer!: ArrayBuffer;

  // Constants
  private static readonly MATRIX_BYTE_SIZE =
    4 * 4 * Float32Array.BYTES_PER_ELEMENT; // 4x4 matrix of 4 bytes = 64 bytes
  private static readonly MAX_LIGHTS = 16; // Max number of lights supported
  /** The layout for the per-instance data buffer. Materials need this to create compatible pipelines. */
  public static readonly INSTANCE_DATA_LAYOUT: GPUVertexBufferLayout = {
    // The stride is for one 4x4 matrices.
    arrayStride: Renderer.MATRIX_BYTE_SIZE,
    stepMode: "instance",
    // Passing the model matrix as 4 vec4 attributes
    // (because it's big to pass through a single location)
    attributes: [
      // Model Matrix (locations 3-6)
      { shaderLocation: 3, offset: 0, format: "float32x4" },
      { shaderLocation: 4, offset: 16, format: "float32x4" },
      { shaderLocation: 5, offset: 32, format: "float32x4" },
      { shaderLocation: 6, offset: 48, format: "float32x4" },
    ],
  };

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
    this.depthFormat = "depth24plus-stencil8";
    this.createDepthTexture();

    const MATRIX_SIZE = 4 * 4 * Float32Array.BYTES_PER_ELEMENT;
    this.cameraUniformBuffer = this.device.createBuffer({
      label: "CAMERA_UNIFORM_BUFFER",
      size: MATRIX_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Scene data buffer: cameraPos (vec3)
    // Using vec4 alignment: 1*vec4 = 16 bytes
    const SCENE_DATA_SIZE = 4 * Float32Array.BYTES_PER_ELEMENT;
    this.sceneDataBuffer = this.device.createBuffer({
      label: "SCENE_DATA_UNIFORM_BUFFER",
      size: SCENE_DATA_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Lights storage buffer
    const lightStructSize = 8 * Float32Array.BYTES_PER_ELEMENT; // 2 vec4s
    const lightStorageBufferSize = 16 + Renderer.MAX_LIGHTS * lightStructSize; // 16 bytes for count+padding
    this.lightStorageBuffer = this.device.createBuffer({
      label: "LIGHT_STORAGE_BUFFER",
      size: lightStorageBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // Create a reusable ArrayBuffer for staging light data
    this.lightDataBuffer = new ArrayBuffer(lightStorageBufferSize);

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
          binding: 1, // Lights Storage Buffer
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2, // Scene Data Uniform Buffer (cameraPos)
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.frameBindGroup = this.device.createBindGroup({
      label: "FRAME_BIND_GROUP",
      layout: this.frameBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniformBuffer } },
        { binding: 1, resource: { buffer: this.lightStorageBuffer } },
        { binding: 2, resource: { buffer: this.sceneDataBuffer } },
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
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
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
    if (this.depthTexture) {
      this.depthTexture.destroy();
    }
    this.depthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height, 1], // 1 array layer (single texture)
      dimension: "2d",
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  /**
   * Renders a given `Scene` from the perspective of a `Camera`.
   * @param camera The camera providing the view and projection matrices.
   * @param scene The scene containing the list of objects to render.
   * @param postSceneDrawCallback An optional callback to execute additional
   *   drawing commands within the main render pass (e.g., for UI).
   */
  public render(
    camera: Camera,
    scene: Scene,
    postSceneDrawCallback?: (scenePassEncoder: GPURenderPassEncoder) => void,
  ): void {
    // =========================================================================
    // Resize Handling
    // =========================================================================

    // Stage 1: If canvas display size has changed, update the
    // drawing buffer size and skip the rest of the frame.
    const newWidth = this.canvas.clientWidth;
    const newHeight = this.canvas.clientHeight;
    if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
      // If the canvas has a non-zero size, update its drawing buffer.
      if (newWidth > 0 && newHeight > 0) {
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
      }
      // Abort the current frame. The next frame will have the correct size.
      // This prevents using a destroyed texture from the old swap chain.
      return;
    }

    // Stage 2: Get the current texture and synchronize other resources to it.
    const currentTexture = this.context.getCurrentTexture();
    const textureView = currentTexture.createView();

    // If our depth texture is out of sync, recreate it and update the camera.
    // This will trigger on the frame after the resize in Stage 1.
    if (
      this.depthTexture.width !== currentTexture.width ||
      this.depthTexture.height !== currentTexture.height
    ) {
      this.createDepthTexture();
      const aspectRatio = currentTexture.width / currentTexture.height;
      camera.setPerspective(
        camera.fovYRadians,
        aspectRatio,
        camera.near,
        camera.far,
      );
    }

    // =========================================================================
    // Scene rendering passes
    // =========================================================================

    // 1. Update camera uniform buffer
    this.device.queue.writeBuffer(
      this.cameraUniformBuffer,
      0,
      camera.viewProjectionMatrix as Float32Array,
    );

    // 2. Update scene data buffer (camera position)
    this.device.queue.writeBuffer(
      this.sceneDataBuffer,
      0,
      camera.position as Float32Array,
    );

    // 3. Update light storage buffer
    const lightCount = Math.min(scene.lights.length, Renderer.MAX_LIGHTS);
    // Use views to write to the same ArrayBuffer with different types
    const lightCountView = new Uint32Array(this.lightDataBuffer, 0, 1);
    const lightDataView = new Float32Array(this.lightDataBuffer, 16);

    lightCountView[0] = lightCount;
    for (let i = 0; i < lightCount; i++) {
      const light = scene.lights[i];
      const offset = i * 8; // Each light is 8 floats (2 vec4s)
      lightDataView.set(light.position, offset);
      lightDataView.set(light.color, offset + 4);
    }
    this.device.queue.writeBuffer(
      this.lightStorageBuffer,
      0,
      this.lightDataBuffer,
    );

    // 4. Partition objects into opaque and transparent lists
    const opaqueRenderables: Renderable[] = [];
    const transparentRenderables: Renderable[] = [];
    for (const renderable of scene.objects) {
      if (renderable.material.isTransparent) {
        transparentRenderables.push(renderable);
      } else {
        opaqueRenderables.push(renderable);
      }
    }

    // 5. Prepare instance data for both lists
    const totalInstanceCount = scene.objects.length;
    const requiredBufferSize = totalInstanceCount * Renderer.MATRIX_BYTE_SIZE;

    if (!this.instanceBuffer || this.instanceBuffer.size < requiredBufferSize) {
      if (this.instanceBuffer) this.instanceBuffer.destroy();
      const newSize = Math.ceil(requiredBufferSize * 1.5);
      this.instanceBuffer = this.device.createBuffer({
        label: "INSTANCE_MODEL_MATRIX_BUFFER",
        size: newSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }

    const commandEncoder = this.device.createCommandEncoder({
      label: "MAIN_COMMAND_ENCODER",
    });
    const scenePassEncoder = commandEncoder.beginRenderPass({
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

    scenePassEncoder.setViewport(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      0,
      1,
    );
    scenePassEncoder.setBindGroup(0, this.frameBindGroup);

    let instanceBufferOffset = 0;

    // 6. Opaque rendering pass (using batching)
    if (opaqueRenderables.length > 0) {
      const batches = new Map<GPURenderPipeline, PipelineBatch>();

      // Group all opaque renderables by their pipeline.
      for (const renderable of opaqueRenderables) {
        const { mesh, material, modelMatrix } = renderable;
        // The material provides the correct pipeline for the given mesh layout.
        const pipeline = material.getPipeline(
          mesh.layouts,
          Renderer.INSTANCE_DATA_LAYOUT,
          this.frameBindGroupLayout,
          this.canvasFormat,
          this.depthFormat,
        );

        if (!batches.has(pipeline)) {
          batches.set(pipeline, {
            material: material, // Store the material to get the bind group later.
            meshMap: new Map<Mesh, Mat4[]>(),
          });
        }

        const pipelineBatch = batches.get(pipeline)!;
        if (!pipelineBatch.meshMap.has(mesh)) {
          pipelineBatch.meshMap.set(mesh, []);
        }
        // Add the model matrix to the list of instances for this mesh.
        pipelineBatch.meshMap.get(mesh)!.push(modelMatrix);
      }

      // iterate over the batches and draw them.
      for (const [pipeline, batch] of batches.entries()) {
        // Set the pipeline and material bind group once for the entire batch.
        scenePassEncoder.setPipeline(pipeline);
        scenePassEncoder.setBindGroup(1, batch.material.bindGroup);

        // draw each mesh within the batch
        for (const [mesh, modelMatrices] of batch.meshMap.entries()) {
          const instanceCount = modelMatrices.length;

          // Create and write the instance data (model matrix) for this mesh.
          const instanceData = new Float32Array(instanceCount * 16); // 1 matrix per instance
          for (let i = 0; i < instanceCount; i++) {
            const modelMatrix = modelMatrices[i];
            // Write model matrix
            instanceData.set(modelMatrix, i * 16);
          }

          const batchByteLength = instanceData.byteLength;
          this.device.queue.writeBuffer(
            this.instanceBuffer,
            instanceBufferOffset,
            instanceData,
          );

          // Set the vertex buffers for the mesh geometry.
          for (let i = 0; i < mesh.buffers.length; i++) {
            scenePassEncoder.setVertexBuffer(i, mesh.buffers[i]);
          }
          // Set the vertex buffer for the instance data.
          scenePassEncoder.setVertexBuffer(
            mesh.buffers.length, // Next available slot
            this.instanceBuffer,
            instanceBufferOffset,
            batchByteLength,
          );

          // Perform the draw call.
          if (mesh.indexBuffer && mesh.indexFormat && mesh.indexCount) {
            scenePassEncoder.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat);
            scenePassEncoder.drawIndexed(
              mesh.indexCount,
              instanceCount,
              0,
              0,
              0,
            );
          } else {
            scenePassEncoder.draw(mesh.vertexCount, instanceCount, 0, 0);
          }

          // Advance the offset for the next batch of instances.
          instanceBufferOffset += batchByteLength;
        }
      }
    }

    // 7. Transparent rendering pass (sort back-to-front and render individually)
    if (transparentRenderables.length > 0) {
      // Sort transparent objects from furthest to nearest
      transparentRenderables.sort((a, b) => {
        // Get world position from model matrix (column 3, elements 0, 1, 2)
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
        // Compare squared distances to avoid expensive sqrt
        const distA = vec3.distanceSq(posA, camera.position);
        const distB = vec3.distanceSq(posB, camera.position);
        return distB - distA; // Sort descending by distance (furthest first)
      });

      // Prepare instance data for all transparent objects in one go.
      // Each object will be drawn with an instanceCount of 1, but we use
      // firstInstance in the draw call to select the correct matrix
      // from this single large buffer.
      const transparentInstanceData = new Float32Array(
        transparentRenderables.length * 16, // 1 matrix per instance
      );
      for (let i = 0; i < transparentRenderables.length; i++) {
        const { modelMatrix } = transparentRenderables[i];
        // Write model matrix
        transparentInstanceData.set(modelMatrix, i * 16);
      }
      this.device.queue.writeBuffer(
        this.instanceBuffer,
        instanceBufferOffset, // Continue writing where the opaque pass left off
        transparentInstanceData,
      );

      // Render sorted transparent objects one by one
      let lastMaterial: null | Material = null;
      let lastMesh: null | Mesh = null;
      let lastPipeline: null | GPURenderPipeline = null;

      for (let i = 0; i < transparentRenderables.length; i++) {
        const { mesh, material } = transparentRenderables[i];

        // Get the pipeline for this specific material and mesh combination.
        const pipeline = material.getPipeline(
          mesh.layouts,
          Renderer.INSTANCE_DATA_LAYOUT,
          this.frameBindGroupLayout,
          this.canvasFormat,
          this.depthFormat,
        );

        // Set pipeline if it has changed.
        if (pipeline !== lastPipeline) {
          scenePassEncoder.setPipeline(pipeline);
          lastPipeline = pipeline;
        }

        // Set material bind group if it has changed.
        if (material !== lastMaterial) {
          scenePassEncoder.setBindGroup(1, material.bindGroup);
          lastMaterial = material;
        }

        // Set vertex/index buffers if the mesh has changed.
        if (mesh !== lastMesh) {
          for (let j = 0; j < mesh.buffers.length; j++) {
            scenePassEncoder.setVertexBuffer(j, mesh.buffers[j]);
          }
          // The instance buffer is set once for all transparent objects,
          // have to be sure it's set if the mesh changes.
          scenePassEncoder.setVertexBuffer(
            mesh.buffers.length,
            this.instanceBuffer,
            instanceBufferOffset, // Base offset for all transparent data
            transparentInstanceData.byteLength,
          );
          if (mesh.indexBuffer) {
            scenePassEncoder.setIndexBuffer(
              mesh.indexBuffer,
              mesh.indexFormat!,
            );
          }
          lastMesh = mesh;
        }

        // Draw this single instance, using 'i' as the firstInstance offset
        // to select the correct matrix from the instance buffer.
        if (mesh.indexBuffer && mesh.indexCount) {
          scenePassEncoder.drawIndexed(mesh.indexCount, 1, 0, 0, i);
        } else {
          scenePassEncoder.draw(mesh.vertexCount, 1, 0, i);
        }
      }
    }

    scenePassEncoder.end();

    // =========================================================================
    // UI rendering pass
    // =========================================================================

    // Call the post-scene draw callback if it exists.
    if (postSceneDrawCallback) {
      const uiPassEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            loadOp: "load", // Load the contents of the previous pass
            storeOp: "store",
          },
        ],
        // no depthStencilAttachment for the UI pass
      });

      postSceneDrawCallback(uiPassEncoder);
      uiPassEncoder.end();
    }

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
}

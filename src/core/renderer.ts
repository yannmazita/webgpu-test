// src/core/renderer.ts
import { Vec3, vec3, Vec4 } from "wgpu-matrix";
import {
  InstanceData,
  Light,
  Mesh,
  PipelineBatch,
  Renderable,
} from "./types/gpu";
import { SceneRenderData } from "./types/rendering";
import { CameraComponent } from "./ecs/components/cameraComponent";

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
  /** A temporary array for writing scene data to the GPU buffer. */
  private sceneDataArray!: Float32Array;
  /** Storage buffer for all light data. */
  private lightStorageBuffer!: GPUBuffer;
  /** A temporary buffer for writing light data. */
  private lightDataBuffer!: ArrayBuffer;
  /** The current capacity of the light storage buffer, in number of lights. */
  private lightStorageBufferCapacity!: number;

  // Constants
  private static readonly MATRIX_BYTE_SIZE =
    4 * 4 * Float32Array.BYTES_PER_ELEMENT; // 4x4 matrix of 4 bytes = 64 bytes
  private static readonly INSTANCE_STRIDE_IN_FLOATS = 20; // 16 for matrix + 1 for flag + 3 for padding
  private static readonly INSTANCE_BYTE_STRIDE =
    Renderer.INSTANCE_STRIDE_IN_FLOATS * Float32Array.BYTES_PER_ELEMENT; // 80 bytes
  /** The layout for the per-instance data buffer. Materials need this to create compatible pipelines. */
  public static readonly INSTANCE_DATA_LAYOUT: GPUVertexBufferLayout = {
    arrayStride: Renderer.INSTANCE_BYTE_STRIDE,
    stepMode: "instance",
    attributes: [
      // Model Matrix (locations 3-6)
      { shaderLocation: 3, offset: 0, format: "float32x4" },
      { shaderLocation: 4, offset: 16, format: "float32x4" },
      { shaderLocation: 5, offset: 32, format: "float32x4" },
      { shaderLocation: 6, offset: 48, format: "float32x4" },
      // isUniformlyScaled flag (location 7)
      {
        shaderLocation: 7,
        offset: Renderer.MATRIX_BYTE_SIZE,
        format: "float32",
      },
    ],
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // 4 floats for cameraPos + 4 floats for ambientColor
    this.sceneDataArray = new Float32Array(8);
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

    // Scene data buffer: cameraPos (vec4) + ambientColor (vec4)
    // Using vec4 alignment: 2*vec4 = 32 bytes
    const SCENE_DATA_SIZE = 8 * Float32Array.BYTES_PER_ELEMENT;
    this.sceneDataBuffer = this.device.createBuffer({
      label: "SCENE_DATA_UNIFORM_BUFFER",
      size: SCENE_DATA_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Lights storage buffer
    this.lightStorageBufferCapacity = 4; // Initial capacity for 4 lights
    const lightStructSize = 8 * Float32Array.BYTES_PER_ELEMENT; // 2 vec4s
    const lightStorageBufferSize =
      16 + this.lightStorageBufferCapacity * lightStructSize; // 16 bytes for count+padding
    this.lightStorageBuffer = this.device.createBuffer({
      label: "LIGHT_STORAGE_BUFFER",
      size: lightStorageBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
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
   * Handles canvas resizing and resource synchronization.
   * @returns `true` if the frame should be skipped, `false` otherwise.
   */
  private _handleResize(camera: CameraComponent): boolean {
    const newWidth = this.canvas.clientWidth;
    const newHeight = this.canvas.clientHeight;

    // Stage 1: If canvas display size has changed, update the
    // drawing buffer size and skip the rest of the frame.
    if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
      if (newWidth > 0 && newHeight > 0) {
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
      }
      return true; // Skip this frame
    }

    // Stage 2: Synchronize other resources to the current texture size.
    // This will trigger on the frame after the resize in Stage 1.
    const currentTexture = this.context.getCurrentTexture();
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
    return false; // Continue with rendering
  }

  /**
   * Updates all per-frame uniform and storage buffers.
   */
  private _updateFrameUniforms(
    camera: CameraComponent,
    lights: Light[],
    ambientColor: Vec4,
  ): void {
    // 1. Update camera uniform buffer
    this.device.queue.writeBuffer(
      this.cameraUniformBuffer,
      0,
      camera.viewProjectionMatrix as Float32Array,
    );

    // 2. Update scene data buffer (camera position & ambient color)
    // Camera position is the translation part of its inverse view matrix (world matrix)
    this.sceneDataArray.set(camera.inverseViewMatrix.slice(12, 15), 0);
    this.sceneDataArray.set(ambientColor, 4);
    this.device.queue.writeBuffer(this.sceneDataBuffer, 0, this.sceneDataArray);

    // 3. Update light storage buffer
    const lightCount = lights.length;
    const lightStructSize = 8 * Float32Array.BYTES_PER_ELEMENT; // 2 vec4s

    if (lightCount > this.lightStorageBufferCapacity) {
      this.lightStorageBuffer.destroy();

      this.lightStorageBufferCapacity = Math.ceil(lightCount * 1.5);
      const newSize = 16 + this.lightStorageBufferCapacity * lightStructSize;

      this.lightStorageBuffer = this.device.createBuffer({
        label: "LIGHT_STORAGE_BUFFER (resized)",
        size: newSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.lightDataBuffer = new ArrayBuffer(newSize);

      this.frameBindGroup = this.device.createBindGroup({
        label: "FRAME_BIND_GROUP (re-bound)",
        layout: this.frameBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.cameraUniformBuffer } },
          { binding: 1, resource: { buffer: this.lightStorageBuffer } },
          { binding: 2, resource: { buffer: this.sceneDataBuffer } },
        ],
      });
    }
    const lightCountView = new Uint32Array(this.lightDataBuffer, 0, 1);
    const lightDataView = new Float32Array(this.lightDataBuffer, 16);
    lightCountView[0] = lightCount;
    for (let i = 0; i < lightCount; i++) {
      const light = lights[i];
      const offset = i * 8; // Each light is 8 floats (2 vec4s)
      lightDataView.set(light.position, offset);
      lightDataView.set(light.color, offset + 4);
    }
    this.device.queue.writeBuffer(
      this.lightStorageBuffer,
      0,
      this.lightDataBuffer,
      0,
      16 + lightCount * lightStructSize,
    );
  }

  /**
   * Checks if the instance buffer is large enough and resizes it if not.
   */
  private _prepareInstanceBuffer(instanceCount: number): void {
    const requiredBufferSize = instanceCount * Renderer.INSTANCE_BYTE_STRIDE;

    if (!this.instanceBuffer || this.instanceBuffer.size < requiredBufferSize) {
      if (this.instanceBuffer) this.instanceBuffer.destroy();
      const newSize = Math.ceil(requiredBufferSize * 1.5); // Allocate 1.5x needed
      this.instanceBuffer = this.device.createBuffer({
        label: "INSTANCE_DATA_BUFFER",
        size: newSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
  }

  /**
   * Renders all opaque objects using batched, instanced draw calls.
   * This method is optimized to minimize GPU state changes and draw calls.
   * @returns The number of bytes written to the instance buffer, which is needed
   *          as an offset for the subsequent transparent pass.
   */
  private _renderOpaquePass(
    passEncoder: GPURenderPassEncoder,
    renderables: Renderable[],
  ): number {
    if (renderables.length === 0) return 0;

    // 1. Batching Phase: Group all renderables by pipeline and then by mesh.
    // The goal is to create large batches of objects that can be drawn together
    // in a single instanced draw call, changing pipelines is expensive so we
    // group that first
    const batches = new Map<GPURenderPipeline, PipelineBatch>();
    for (const renderable of renderables) {
      const { mesh, material, modelMatrix, isUniformlyScaled } = renderable;

      // The material caches this pipeline, so this is a fast lookup.
      const pipeline = material.getPipeline(
        mesh.layouts,
        Renderer.INSTANCE_DATA_LAYOUT,
        this.frameBindGroupLayout,
        this.canvasFormat,
        this.depthFormat,
      );

      // If we haven't seen this pipeline before, create a new top-level batch for it.
      if (!batches.has(pipeline)) {
        batches.set(pipeline, {
          material: material,
          meshMap: new Map<Mesh, InstanceData[]>(),
        });
      }
      const pipelineBatch = batches.get(pipeline)!;

      // Within the pipeline batch, group instances by their mesh.
      if (!pipelineBatch.meshMap.has(mesh)) {
        pipelineBatch.meshMap.set(mesh, []);
      }
      pipelineBatch.meshMap.get(mesh)!.push({ modelMatrix, isUniformlyScaled });
    }

    // 2. Drawing Phase: Iterate through the batches and issue draw calls.
    let instanceBufferOffset = 0;
    for (const [pipeline, batch] of batches.entries()) {
      // Set the pipeline and material bind group once for all meshes in this batch.
      passEncoder.setPipeline(pipeline);
      passEncoder.setBindGroup(1, batch.material.bindGroup);

      for (const [mesh, instances] of batch.meshMap.entries()) {
        const instanceCount = instances.length;

        // Prepare the instance data (model matrices, etc.) for this specific sub-batch.
        const instanceData = new Float32Array(
          instanceCount * Renderer.INSTANCE_STRIDE_IN_FLOATS,
        );
        for (let i = 0; i < instanceCount; i++) {
          const { modelMatrix, isUniformlyScaled } = instances[i];
          const offsetInFloats = i * Renderer.INSTANCE_STRIDE_IN_FLOATS;
          instanceData.set(modelMatrix, offsetInFloats);
          instanceData[offsetInFloats + 16] = isUniformlyScaled ? 1.0 : 0.0;
        }

        const batchByteLength = instanceData.byteLength;

        // Write this sub-batch's data into the shared instance buffer at the correct offset.
        this.device.queue.writeBuffer(
          this.instanceBuffer,
          instanceBufferOffset,
          instanceData,
        );

        // Set the mesh-specific vertex buffers.
        for (let i = 0; i < mesh.buffers.length; i++) {
          passEncoder.setVertexBuffer(i, mesh.buffers[i]);
        }
        // Set the instance data buffer, pointing to the specific slice for this batch.
        passEncoder.setVertexBuffer(
          mesh.buffers.length,
          this.instanceBuffer,
          instanceBufferOffset,
          batchByteLength,
        );

        // Issue the single instanced draw call for this sub-batch.
        if (mesh.indexBuffer && mesh.indexFormat && mesh.indexCount) {
          passEncoder.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat);
          passEncoder.drawIndexed(mesh.indexCount, instanceCount, 0, 0, 0);
        } else {
          passEncoder.draw(mesh.vertexCount, instanceCount, 0, 0);
        }

        // Advance the offset for the next batch.
        instanceBufferOffset += batchByteLength;
      }
    }
    return instanceBufferOffset;
  }

  /**
   * Renders all transparent objects, sorted back-to-front, using instancing
   * for contiguous batches of identical objects.
   */
  private _renderTransparentPass(
    passEncoder: GPURenderPassEncoder,
    renderables: Renderable[],
    camera: CameraComponent,
    instanceBufferOffset: number,
  ): void {
    if (renderables.length === 0) return;

    // 1. Sort all transparent objects from back-to-front relative to the camera.
    renderables.sort((a, b) => {
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
      const cameraPosVec3 = camera.inverseViewMatrix.slice(12, 15) as Vec3;
      const distA = vec3.distanceSq(posA, cameraPosVec3);
      const distB = vec3.distanceSq(posB, cameraPosVec3);
      return distB - distA;
    });

    // 2. Write all instance data for the sorted objects into the GPU buffer.
    const instanceData = new Float32Array(
      renderables.length * Renderer.INSTANCE_STRIDE_IN_FLOATS,
    );
    for (let i = 0; i < renderables.length; i++) {
      const { modelMatrix, isUniformlyScaled } = renderables[i];
      const offsetInFloats = i * Renderer.INSTANCE_STRIDE_IN_FLOATS;
      instanceData.set(modelMatrix, offsetInFloats);
      instanceData[offsetInFloats + 16] = isUniformlyScaled ? 1.0 : 0.0;
    }
    this.device.queue.writeBuffer(
      this.instanceBuffer,
      instanceBufferOffset,
      instanceData,
    );

    // 3. Iterate through the sorted list, batching consecutive identical
    //    objects into single instanced draw calls.
    let i = 0;
    while (i < renderables.length) {
      const firstInBatch = renderables[i];
      const { mesh, material } = firstInBatch;

      // Set pipeline and material bind group for the upcoming batch.
      const pipeline = material.getPipeline(
        mesh.layouts,
        Renderer.INSTANCE_DATA_LAYOUT,
        this.frameBindGroupLayout,
        this.canvasFormat,
        this.depthFormat,
      );
      passEncoder.setPipeline(pipeline);
      passEncoder.setBindGroup(1, material.bindGroup);

      // Set the mesh-specific vertex and index buffers.
      for (let j = 0; j < mesh.buffers.length; j++) {
        passEncoder.setVertexBuffer(j, mesh.buffers[j]);
      }
      // Set the single instance data buffer for all transparent objects.
      passEncoder.setVertexBuffer(
        mesh.buffers.length,
        this.instanceBuffer,
        instanceBufferOffset,
        instanceData.byteLength,
      );
      if (mesh.indexBuffer) {
        passEncoder.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat!);
      }

      // Find how many consecutive renderables use the same mesh and material.
      let count = 1;
      while (i + count < renderables.length) {
        const nextInBatch = renderables[i + count];
        if (nextInBatch.mesh === mesh && nextInBatch.material === material) {
          count++;
        } else {
          break; // End of this batch
        }
      }

      // Issue a single instanced draw call for the entire batch.
      if (mesh.indexBuffer && mesh.indexCount) {
        passEncoder.drawIndexed(mesh.indexCount, count, 0, 0, i);
      } else {
        passEncoder.draw(mesh.vertexCount, count, 0, i);
      }

      // Advance main index to the start of the next potential batch.
      i += count;
    }
  }

  /**
   * Executes the post-scene draw callback in a separate render pass.
   */
  private _renderUIPass(
    commandEncoder: GPUCommandEncoder,
    textureView: GPUTextureView,
    callback: (passEncoder: GPURenderPassEncoder) => void,
  ): void {
    const uiPassEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          loadOp: "load",
          storeOp: "store",
        },
      ],
    });
    callback(uiPassEncoder);
    uiPassEncoder.end();
  }

  /**
   * Renders a given Scene from the perspective of a Camera.
   * @param camera The camera providing the view and projection matrices.
   * @param sceneData A container with all the data needed for this frame's render.
   * @param postSceneDrawCallback An optional callback to execute additional
   *   drawing commands within the main render pass (like for the UI).
   */
  public render(
    camera: CameraComponent,
    sceneData: SceneRenderData,
    postSceneDrawCallback?: (scenePassEncoder: GPURenderPassEncoder) => void,
  ): void {
    // Abort frame if canvas is not ready
    if (this._handleResize(camera)) {
      return;
    }

    const textureView = this.context.getCurrentTexture().createView();

    // Update all per-frame GPU buffers
    this._updateFrameUniforms(camera, sceneData.lights, sceneData.ambientColor);

    // Prepare scene objects
    const allRenderables = sceneData.renderables;
    const opaqueRenderables: Renderable[] = [];
    const transparentRenderables: Renderable[] = [];
    for (const renderable of allRenderables) {
      if (renderable.material.isTransparent) {
        transparentRenderables.push(renderable);
      } else {
        opaqueRenderables.push(renderable);
      }
    }

    // Ensure instance buffer is large enough for all objects
    this._prepareInstanceBuffer(allRenderables.length);

    // Begin encoding commands
    const commandEncoder = this.device.createCommandEncoder({
      label: "MAIN_COMMAND_ENCODER",
    });

    // Main scene render pass
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

    // Opaque objects pass
    const opaqueBytesWritten = this._renderOpaquePass(
      scenePassEncoder,
      opaqueRenderables,
    );

    // Transparent objects pass
    this._renderTransparentPass(
      scenePassEncoder,
      transparentRenderables,
      camera,
      opaqueBytesWritten,
    );

    scenePassEncoder.end();

    // UI render pass
    if (postSceneDrawCallback) {
      this._renderUIPass(commandEncoder, textureView, postSceneDrawCallback);
    }

    // Submit all GPU commands for this frame
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

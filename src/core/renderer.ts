// src/core/renderer.ts
import { Vec3, vec3, Vec4 } from "wgpu-matrix";
import { Light, Mesh, Renderable } from "./types/gpu";
import { Material } from "@/core/materials/material";
import { SceneRenderData } from "./types/rendering";
import { CameraComponent } from "./ecs/components/cameraComponent";
import { BatchManager } from "./rendering/batchManager";
import { UniformManager } from "./rendering/uniformManager";
import { Profiler } from "./utils/profiler";

/**
 * A pre-computed batch of objects that can be drawn with a single instanced draw call.
 */
interface DrawBatch {
  pipeline: GPURenderPipeline;
  material: Material;
  mesh: Mesh;
  instanceCount: number;
  firstInstance: number; // The starting offset in the global instance buffer.
}

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
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private context!: GPUCanvasContext;
  private adapter!: GPUAdapter;
  private instanceBuffer!: GPUBuffer;
  private depthTexture!: GPUTexture;

  // Optimization managers
  private batchManager!: BatchManager;
  private uniformManager!: UniformManager;

  // Per-frame data
  private frameBindGroupLayout!: GPUBindGroupLayout;
  private frameBindGroup!: GPUBindGroup;
  private cameraUniformBuffer!: GPUBuffer;
  private sceneDataBuffer!: GPUBuffer;
  private lightStorageBuffer!: GPUBuffer;
  private lightStorageBufferCapacity!: number;

  // CPU-side buffer for all instance data for a single frame
  private frameInstanceData!: Float32Array;
  private frameInstanceCapacity = 100; // Initial capacity

  // Cached state for resize handling
  private lastCanvasWidth = 0;
  private lastCanvasHeight = 0;
  private lastTextureWidth = 0;
  private lastTextureHeight = 0;

  // Pre-allocated arrays for render data
  private visibleRenderables: Renderable[] = [];
  private transparentRenderables: Renderable[] = [];
  private opaqueBatches: DrawBatch[] = [];

  // Stable sort for transparent objects
  private transparentSortIndices: number[] = [];

  private tempVec3A: Vec3 = vec3.create();
  private tempVec3B: Vec3 = vec3.create();
  private tempCameraPos: Vec3 = vec3.create();

  private resizeObserver?: ResizeObserver;
  private resizePending = true;
  private cssWidth = 0;
  private cssHeight = 0;
  private currentDPR = 1;

  // Constants
  private static readonly MATRIX_BYTE_SIZE =
    4 * 4 * Float32Array.BYTES_PER_ELEMENT;
  private static readonly INSTANCE_STRIDE_IN_FLOATS = 26; // mat4(16) + flag(1) + mat3(9)
  private static readonly INSTANCE_BYTE_STRIDE =
    Renderer.INSTANCE_STRIDE_IN_FLOATS * Float32Array.BYTES_PER_ELEMENT;

  public static readonly INSTANCE_DATA_LAYOUT: GPUVertexBufferLayout = {
    arrayStride: 104, // 26 floats * 4 bytes
    stepMode: "instance",
    attributes: [
      { shaderLocation: 3, offset: 0, format: "float32x4" },
      { shaderLocation: 4, offset: 16, format: "float32x4" },
      { shaderLocation: 5, offset: 32, format: "float32x4" },
      { shaderLocation: 6, offset: 48, format: "float32x4" },
      { shaderLocation: 7, offset: 64, format: "float32" }, // is_uniformly_scaled
      { shaderLocation: 8, offset: 68, format: "float32x3" }, // normal_mat_col_0
      { shaderLocation: 9, offset: 80, format: "float32x3" }, // normal_mat_col_1
      { shaderLocation: 10, offset: 92, format: "float32x3" }, // normal_mat_col_2
    ],
  };
  public static RENDER_SCALE = 1.0;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
  }

  public async init(): Promise<void> {
    await this.setupDevice();
    this.setupContext();

    // Determine environment (DOM canvas vs OffscreenCanvas)
    const isHTMLCanvas =
      typeof (this.canvas as any).getBoundingClientRect === "function";

    if (isHTMLCanvas) {
      // Main thread: safe to access window and observe DOM canvas
      this.currentDPR =
        typeof window !== "undefined" && (window as any)
          ? window.devicePixelRatio || 1
          : 1;
      this._setupResizeObserver();
      const rect = (this.canvas as HTMLCanvasElement).getBoundingClientRect();
      this.cssWidth = Math.max(0, Math.floor(rect.width));
      this.cssHeight = Math.max(0, Math.floor(rect.height));
      this.resizePending = true;
    } else {
      // Worker with OffscreenCanvas: main thread will send RESIZE messages
      this.currentDPR = 1;
      this.resizePending = false;
    }

    this.depthFormat = "depth24plus";
    this.createDepthTexture();

    this.cameraUniformBuffer = this.device.createBuffer({
      label: "CAMERA_UNIFORM_BUFFER",
      size: 4 * 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.sceneDataBuffer = this.device.createBuffer({
      label: "SCENE_DATA_UNIFORM_BUFFER",
      size: 8 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.lightStorageBufferCapacity = 4;
    const lightStructSize = 8 * 4;
    const lightStorageBufferSize =
      16 + this.lightStorageBufferCapacity * lightStructSize;
    this.lightStorageBuffer = this.device.createBuffer({
      label: "LIGHT_STORAGE_BUFFER",
      size: lightStorageBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.frameBindGroupLayout = this.device.createBindGroupLayout({
      label: "FRAME_BIND_GROUP_LAYOUT",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
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

    this.batchManager = new BatchManager(100);
    this.uniformManager = new UniformManager();
    this.frameInstanceData = new Float32Array(
      this.frameInstanceCapacity * Renderer.INSTANCE_STRIDE_IN_FLOATS,
    );
  }

  private _setupResizeObserver(): void {
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === (this.canvas as any)) {
            const cr = entry.contentRect;
            this.cssWidth = Math.max(0, Math.floor(cr.width));
            this.cssHeight = Math.max(0, Math.floor(cr.height));
            this.resizePending = true;
          }
        }
      });
      // Only observe if DOM canvas
      if (typeof (this.canvas as any).getBoundingClientRect === "function") {
        this.resizeObserver.observe(this.canvas as HTMLCanvasElement);
      }
    }
    // Only attach window listener in main thread
    if (typeof window !== "undefined" && window && window.addEventListener) {
      window.addEventListener("resize", () => {
        this.currentDPR = window.devicePixelRatio || 1;
        const rect =
          typeof (this.canvas as any).getBoundingClientRect === "function"
            ? (this.canvas as HTMLCanvasElement).getBoundingClientRect()
            : { width: this.cssWidth, height: this.cssHeight };
        this.cssWidth = Math.max(0, Math.floor(rect.width));
        this.cssHeight = Math.max(0, Math.floor(rect.height));
        this.resizePending = true;
      });
    }
  }

  /**
   * External resize hook for worker-driven sizing. Computes physical size,
   * updates canvas, depth texture, and camera aspect immediately.
   */
  public requestResize(
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio: number,
    camera: CameraComponent,
  ): void {
    // Apply render scale to DPR
    this.currentDPR = (devicePixelRatio || 1) * Renderer.RENDER_SCALE;
    this.cssWidth = Math.max(0, Math.floor(cssWidth));
    this.cssHeight = Math.max(0, Math.floor(cssHeight));
    const physW = Math.max(1, Math.round(this.cssWidth * this.currentDPR));
    const physH = Math.max(1, Math.round(this.cssHeight * this.currentDPR));
    if (
      (this.canvas as any).width !== physW ||
      (this.canvas as any).height !== physH
    ) {
      (this.canvas as any).width = physW;
      (this.canvas as any).height = physH;
      this.createDepthTexture();
      camera.setPerspective(
        camera.fovYRadians,
        physW / physH,
        camera.near,
        camera.far,
      );
    }
    this.resizePending = false;
  }

  private async setupDevice(): Promise<void> {
    if (!navigator.gpu)
      throw new Error("WebGPU is not supported by this browser.");
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });

    if (!adapter) throw new Error("Failed to get GPU adapter.");
    this.adapter = adapter;
    this.device = await this.adapter.requestDevice();

    // Diagnostics: detect software fallback
    // Chrome implements isFallbackAdapter; if true, we're likely on SwiftShader (CPU).
    const anyAdapter = this.adapter as any;
    if (typeof anyAdapter.isFallbackAdapter === "boolean") {
      console.warn("WebGPU Adapter fallback:", anyAdapter.isFallbackAdapter);
    } else {
      console.warn("WebGPU Adapter fallback: unknown (property not available)");
    }
  }

  private setupContext(): void {
    // OffscreenCanvas also supports 'webgpu' context in workers; use a safe cast.
    const canvasAny = this.canvas as any;
    this.context = canvasAny.getContext("webgpu") as GPUCanvasContext;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.canvasFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: "premultiplied",
    });
  }

  private createDepthTexture(): void {
    if (this.depthTexture) this.depthTexture.destroy();
    this.depthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private _handleResize(camera: CameraComponent): boolean {
    if (!this.resizePending) return false;

    // Apply dynamic resolution scaling consistently on the DOM canvas path
    const effectiveDpr = (this.currentDPR || 1) * Renderer.RENDER_SCALE;
    const physW = Math.max(1, Math.round(this.cssWidth * effectiveDpr));
    const physH = Math.max(1, Math.round(this.cssHeight * effectiveDpr));

    if (this.canvas.width !== physW || this.canvas.height !== physH) {
      this.canvas.width = physW;
      this.canvas.height = physH;
      // Recreate depth texture for new size
      this.createDepthTexture();
      // Update camera aspect immediately
      camera.setPerspective(
        camera.fovYRadians,
        physW / physH,
        camera.near,
        camera.far,
      );
    }

    this.resizePending = false;
    return true;
  }

  private _updateFrameUniforms(
    camera: CameraComponent,
    lights: Light[],
    ambientColor: Vec4,
  ): void {
    // Always write small uniforms; cheaper than branching
    this.uniformManager.updateCameraUniform(
      this.device,
      this.cameraUniformBuffer,
      camera,
    );
    this.uniformManager.updateSceneUniform(
      this.device,
      this.sceneDataBuffer,
      camera,
      ambientColor,
    );

    // Always write lights; ensure capacity
    const lightCount = lights.length;
    const lightStructSize = 8 * 4; // 8 floats
    const lightDataBuffer = this.uniformManager.getLightDataBuffer(lightCount);

    if (lightCount > this.lightStorageBufferCapacity) {
      // Recreate GPU storage buffer and rebind
      this.lightStorageBuffer.destroy();
      this.lightStorageBufferCapacity = Math.ceil(lightCount * 1.5);
      const newSize = 16 + this.lightStorageBufferCapacity * lightStructSize;
      this.lightStorageBuffer = this.device.createBuffer({
        label: "LIGHT_STORAGE_BUFFER (resized)",
        size: newSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
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

    // Pack: 16 bytes header (u32 count, padded), then [position vec4][color vec4] * N
    const countHeader = new Uint32Array(lightDataBuffer, 0, 1);
    const lightDataView = new Float32Array(lightDataBuffer, 16);
    countHeader[0] = lightCount;
    for (let i = 0; i < lightCount; i++) {
      const offset = i * 8;
      lightDataView.set(lights[i].position, offset);
      lightDataView.set(lights[i].color, offset + 4);
    }
    this.device.queue.writeBuffer(
      this.lightStorageBuffer,
      0,
      lightDataBuffer,
      0,
      16 + lightCount * lightStructSize,
    );
  }

  private _prepareInstanceBuffer(instanceCount: number): void {
    const requiredBufferSize = instanceCount * Renderer.INSTANCE_BYTE_STRIDE;
    if (!this.instanceBuffer || this.instanceBuffer.size < requiredBufferSize) {
      if (this.instanceBuffer) this.instanceBuffer.destroy();
      const newSize = Math.ceil(requiredBufferSize * 1.5);
      this.instanceBuffer = this.device.createBuffer({
        label: "INSTANCE_DATA_BUFFER",
        size: newSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
  }

  private _isInFrustum(
    renderable: Renderable,
    camera: CameraComponent,
  ): boolean {
    const mx = renderable.modelMatrix[12];
    const my = renderable.modelMatrix[13];
    const mz = renderable.modelMatrix[14];

    // Approximate radius from scale
    const sx = renderable.modelMatrix[0];
    const sy = renderable.modelMatrix[5];
    const sz = renderable.modelMatrix[10];
    const radius = Math.max(sx, sy, sz) * 2.0;

    const cx = camera.inverseViewMatrix[12];
    const cy = camera.inverseViewMatrix[13];
    const cz = camera.inverseViewMatrix[14];

    const dx = mx - cx;
    const dy = my - cy;
    const dz = mz - cz;
    const distSq = dx * dx + dy * dy + dz * dz;

    const farPlusR = camera.far + radius;
    return distSq < farPlusR * farPlusR;
  }

  private _renderOpaquePass(
    passEncoder: GPURenderPassEncoder,
    batches: DrawBatch[],
  ): void {
    if (batches.length === 0) return;

    let lastMaterial: Material | null = null;
    let lastMesh: Mesh | null = null;

    for (const batch of batches) {
      passEncoder.setPipeline(batch.pipeline);
      if (batch.material !== lastMaterial) {
        passEncoder.setBindGroup(1, batch.material.bindGroup);
        lastMaterial = batch.material;
      }
      if (batch.mesh !== lastMesh) {
        for (let i = 0; i < batch.mesh.buffers.length; i++) {
          passEncoder.setVertexBuffer(i, batch.mesh.buffers[i]);
        }
        // bind instance buffer at the byte offset for this batch's first instance
        const instanceByteOffset =
          batch.firstInstance * Renderer.INSTANCE_BYTE_STRIDE;
        passEncoder.setVertexBuffer(
          batch.mesh.buffers.length,
          this.instanceBuffer,
          instanceByteOffset,
        );

        if (batch.mesh.indexBuffer) {
          passEncoder.setIndexBuffer(
            batch.mesh.indexBuffer,
            batch.mesh.indexFormat!,
          );
        }
        lastMesh = batch.mesh;
      }

      if (batch.mesh.indexBuffer) {
        passEncoder.drawIndexed(
          batch.mesh.indexCount!,
          batch.instanceCount,
          0,
          0,
          batch.firstInstance,
        );
      } else {
        passEncoder.draw(
          batch.mesh.vertexCount,
          batch.instanceCount,
          0,
          batch.firstInstance,
        );
      }
    }
  }

  private _renderTransparentPass(
    passEncoder: GPURenderPassEncoder,
    renderables: Renderable[],
    camera: CameraComponent,
    instanceBufferOffset: number, // bytes
  ): void {
    if (renderables.length === 0) return;

    // Camera position (from inverse view)
    this.tempCameraPos[0] = camera.inverseViewMatrix[12];
    this.tempCameraPos[1] = camera.inverseViewMatrix[13];
    this.tempCameraPos[2] = camera.inverseViewMatrix[14];

    // Sort back-to-front (greater distance first)
    renderables.sort((a, b) => {
      this.tempVec3A[0] = a.modelMatrix[12];
      this.tempVec3A[1] = a.modelMatrix[13];
      this.tempVec3A[2] = a.modelMatrix[14];
      this.tempVec3B[0] = b.modelMatrix[12];
      this.tempVec3B[1] = b.modelMatrix[13];
      this.tempVec3B[2] = b.modelMatrix[14];
      const da = vec3.distanceSq(this.tempVec3A, this.tempCameraPos);
      const db = vec3.distanceSq(this.tempVec3B, this.tempCameraPos);
      return db - da;
    });

    const floatsPerInstance = Renderer.INSTANCE_STRIDE_IN_FLOATS; // 26
    const instanceDataView = new Float32Array(
      this.frameInstanceData.buffer,
      instanceBufferOffset,
      renderables.length * floatsPerInstance,
    );

    // Pack instance data: mat4 (16), flag (1), normal mat3 columns (9)
    for (let i = 0; i < renderables.length; i++) {
      const { modelMatrix, isUniformlyScaled, normalMatrix } = renderables[i];
      const off = i * floatsPerInstance;

      // Model matrix
      instanceDataView.set(modelMatrix, off);

      // is_uniformly_scaled flag
      instanceDataView[off + 16] = isUniformlyScaled ? 1.0 : 0.0;

      // Normal matrix columns (3x vec3)
      if (isUniformlyScaled) {
        // Derive from model matrix upper 3x3 (column-major)
        instanceDataView[off + 17] = modelMatrix[0];
        instanceDataView[off + 18] = modelMatrix[1];
        instanceDataView[off + 19] = modelMatrix[2];

        instanceDataView[off + 20] = modelMatrix[4];
        instanceDataView[off + 21] = modelMatrix[5];
        instanceDataView[off + 22] = modelMatrix[6];

        instanceDataView[off + 23] = modelMatrix[8];
        instanceDataView[off + 24] = modelMatrix[9];
        instanceDataView[off + 25] = modelMatrix[10];
      } else {
        // Use precomputed normal matrix (column-major)
        instanceDataView[off + 17] = normalMatrix[0];
        instanceDataView[off + 18] = normalMatrix[1];
        instanceDataView[off + 19] = normalMatrix[2];

        instanceDataView[off + 20] = normalMatrix[3];
        instanceDataView[off + 21] = normalMatrix[4];
        instanceDataView[off + 22] = normalMatrix[5];

        instanceDataView[off + 23] = normalMatrix[6];
        instanceDataView[off + 24] = normalMatrix[7];
        instanceDataView[off + 25] = normalMatrix[8];
      }
    }

    // Upload instance data for transparent objects at the given GPU offset
    this.device.queue.writeBuffer(
      this.instanceBuffer,
      instanceBufferOffset,
      instanceDataView,
    );

    // Draw, batching consecutive renderables with same mesh and material
    let i = 0;
    while (i < renderables.length) {
      const { mesh, material } = renderables[i];
      const pipeline = material.getPipeline(
        mesh.layouts,
        Renderer.INSTANCE_DATA_LAYOUT,
        this.frameBindGroupLayout,
        this.canvasFormat,
        this.depthFormat,
      );

      passEncoder.setPipeline(pipeline);
      passEncoder.setBindGroup(1, material.bindGroup);

      // Bind mesh vertex buffers
      for (let j = 0; j < mesh.buffers.length; j++) {
        passEncoder.setVertexBuffer(j, mesh.buffers[j]);
      }

      // Bind instance buffer immediately after mesh buffers
      passEncoder.setVertexBuffer(
        mesh.buffers.length,
        this.instanceBuffer,
        instanceBufferOffset,
        instanceDataView.byteLength,
      );

      if (mesh.indexBuffer) {
        passEncoder.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat!);
      }

      // Count consecutive instances with same mesh and material
      let count = 1;
      while (
        i + count < renderables.length &&
        renderables[i + count].mesh === mesh &&
        renderables[i + count].material === material
      ) {
        count++;
      }

      if (mesh.indexBuffer) {
        passEncoder.drawIndexed(mesh.indexCount!, count, 0, 0, i);
      } else {
        passEncoder.draw(mesh.vertexCount, count, 0, i);
      }

      i += count;
    }
  }

  private _renderUIPass(
    commandEncoder: GPUCommandEncoder,
    textureView: GPUTextureView,
    callback: (passEncoder: GPURenderPassEncoder) => void,
  ): void {
    const uiPassEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        { view: textureView, loadOp: "load", storeOp: "store" },
      ],
    });
    uiPassEncoder.setViewport(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      0,
      1,
    );
    callback(uiPassEncoder);
    uiPassEncoder.end();
  }

  public render(
    camera: CameraComponent,
    sceneData: SceneRenderData,
    postSceneDrawCallback?: (scenePassEncoder: GPURenderPassEncoder) => void,
  ): void {
    Profiler.begin("Render.Total");
    Profiler.begin("Render.HandleResize");
    this._handleResize(camera);
    Profiler.end("Render.HandleResize");

    if (this.canvas.width === 0 || this.canvas.height === 0) {
      Profiler.end("Render.Total");
      return;
    }

    Profiler.begin("Render.UpdateUniforms");
    this._updateFrameUniforms(camera, sceneData.lights, sceneData.ambientColor);
    Profiler.end("Render.UpdateUniforms");

    Profiler.begin("Render.FrustumCullAndSeparate");
    // Use pre-allocated arrays to avoid GC
    this.visibleRenderables.length = 0;
    this.transparentRenderables.length = 0;

    for (const r of sceneData.renderables) {
      if (this._isInFrustum(r, camera)) {
        if (r.material.isTransparent) {
          this.transparentRenderables.push(r);
        } else {
          this.visibleRenderables.push(r);
        }
      }
    }
    Profiler.end("Render.FrustumCullAndSeparate");

    let totalInstances = 0;

    Profiler.begin("Render.Batching");
    // Use the BatchManager to get cached batches instead of rebuilding every frame.
    const getPipelineCallback = (material: Material, mesh: Mesh) =>
      material.getPipeline(
        mesh.layouts,
        Renderer.INSTANCE_DATA_LAYOUT,
        this.frameBindGroupLayout,
        this.canvasFormat,
        this.depthFormat,
      );

    const opaquePipelineBatches = this.batchManager.getOpaqueBatches(
      this.visibleRenderables,
      getPipelineCallback,
    );

    // Clear the pre-allocated draw batch array
    this.opaqueBatches.length = 0;

    // Process the batches from the BatchManager to create draw calls and instance data
    for (const [pipeline, pipelineBatch] of opaquePipelineBatches.entries()) {
      for (const [mesh, instances] of pipelineBatch.meshMap.entries()) {
        if (instances.length === 0) continue;

        // Create a DrawBatch for our render pass
        this.opaqueBatches.push({
          pipeline,
          material: pipelineBatch.material,
          mesh,
          instanceCount: instances.length,
          firstInstance: totalInstances,
        });

        // Write instance data to the CPU-side buffer
        for (const instance of instances) {
          const offset = totalInstances * Renderer.INSTANCE_STRIDE_IN_FLOATS;

          // modelMatrix (16 floats)
          this.frameInstanceData.set(instance.modelMatrix, offset);

          // is_uniformly_scaled flag (1 float)
          this.frameInstanceData[offset + 16] = instance.isUniformlyScaled
            ? 1.0
            : 0.0;

          // normal matrix columns (3x vec3 = 9 floats) at offsets 17..25
          if (instance.isUniformlyScaled) {
            // Fast path: derive from upper 3x3 of model matrix
            const m = instance.modelMatrix;
            // col 0 -> indices 0,1,2
            this.frameInstanceData[offset + 17] = m[0];
            this.frameInstanceData[offset + 18] = m[1];
            this.frameInstanceData[offset + 19] = m[2];
            // col 1 -> indices 4,5,6
            this.frameInstanceData[offset + 20] = m[4];
            this.frameInstanceData[offset + 21] = m[5];
            this.frameInstanceData[offset + 22] = m[6];
            // col 2 -> indices 8,9,10
            this.frameInstanceData[offset + 23] = m[8];
            this.frameInstanceData[offset + 24] = m[9];
            this.frameInstanceData[offset + 25] = m[10];
          } else {
            // Use precomputed normal matrix
            const n = instance.normalMatrix;
            // col 0
            this.frameInstanceData[offset + 17] = n[0];
            this.frameInstanceData[offset + 18] = n[1];
            this.frameInstanceData[offset + 19] = n[2];
            // col 1
            this.frameInstanceData[offset + 20] = n[3];
            this.frameInstanceData[offset + 21] = n[4];
            this.frameInstanceData[offset + 22] = n[5];
            // col 2
            this.frameInstanceData[offset + 23] = n[6];
            this.frameInstanceData[offset + 24] = n[7];
            this.frameInstanceData[offset + 25] = n[8];
          }

          totalInstances++;
        }
      }
    }
    Profiler.end("Render.Batching");

    Profiler.begin("Render.WriteInstanceBuffer");
    this._prepareInstanceBuffer(totalInstances);
    if (totalInstances > 0) {
      this.device.queue.writeBuffer(
        this.instanceBuffer,
        0,
        this.frameInstanceData.buffer,
        0,
        totalInstances * Renderer.INSTANCE_BYTE_STRIDE,
      );
    }
    Profiler.end("Render.WriteInstanceBuffer");

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();
    // Determine if current depth format includes a stencil aspect
    const hasStencil =
      this.depthFormat === "depth24plus-stencil8" ||
      this.depthFormat === ("depth32float-stencil8" as GPUTextureFormat);

    const depthAttachment: GPURenderPassDepthStencilAttachment = {
      view: this.depthTexture.createView(),
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    };

    // If format has stencil, WebGPU requires stencilLoadOp and stencilStoreOp
    if (hasStencil) {
      // We don't use stencil yet; clear then discard to avoid any overhead
      depthAttachment.stencilClearValue = 0;
      depthAttachment.stencilLoadOp = "clear";
      depthAttachment.stencilStoreOp = "discard";
    }

    const scenePassEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0.1, g: 0.1, b: 0.15, a: 1.0 },
        },
      ],
      depthStencilAttachment: depthAttachment,
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

    Profiler.begin("Render.OpaquePass");
    this._renderOpaquePass(scenePassEncoder, this.opaqueBatches);
    Profiler.end("Render.OpaquePass");

    Profiler.begin("Render.TransparentPass");
    this._renderTransparentPass(
      scenePassEncoder,
      this.transparentRenderables,
      camera,
      totalInstances * Renderer.INSTANCE_BYTE_STRIDE,
    );
    Profiler.end("Render.TransparentPass");

    scenePassEncoder.end();

    if (postSceneDrawCallback) {
      this._renderUIPass(commandEncoder, textureView, postSceneDrawCallback);
    }

    Profiler.begin("Render.Submit");
    this.device.queue.submit([commandEncoder.finish()]);
    Profiler.end("Render.Submit");

    Profiler.end("Render.Total");
  }

  public getFrameBindGroupLayout(): GPUBindGroupLayout {
    if (!this.frameBindGroupLayout)
      throw new Error(
        "Frame bind group layout is not initialized. Call init() first.",
      );
    return this.frameBindGroupLayout;
  }
}

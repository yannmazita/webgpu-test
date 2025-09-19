// src/core/renderer.ts
import { Vec3, vec3 } from "wgpu-matrix";
import { Light, Mesh, Renderable } from "./types/gpu";
import { Material } from "@/core/materials/material";
import { SceneRenderData } from "./types/rendering";
import { CameraComponent } from "./ecs/components/cameraComponent";
import { BatchManager } from "./rendering/batchManager";
import { UniformManager } from "./rendering/uniformManager";
import { Profiler } from "./utils/profiler";
import { testAABBFrustum, transformAABB } from "./utils/bounds";
import { ClusterBuilder } from "@/core/rendering/clusterBuilder";
import { ShadowSubsystem } from "@/core/rendering/shadow";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/sunComponent";
import { MaterialInstance } from "./materials/materialInstance";

export interface RendererStats {
  canvasWidth: number;
  canvasHeight: number;
  lightCount: number;
  visibleOpaque: number;
  visibleTransparent: number;
  drawsOpaque: number;
  drawsTransparent: number;
  instancesOpaque: number;
  instancesTransparent: number;
  cpuTotalUs: number;
  clusterAvgLpcX1000?: number;
  clusterMaxLpc?: number;
  clusterOverflows?: number;
}

/**
 * A pre-computed batch of objects that can be drawn with a single instanced draw call.
 */
interface DrawBatch {
  pipeline: GPURenderPipeline;
  materialInstance: MaterialInstance;
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
  /** The default texture sampler for the renderer. */
  public defaultSampler!: GPUSampler;
  /** The format of the canvas texture. */
  public canvasFormat!: GPUTextureFormat;
  /** The format of the depth texture. */
  public depthFormat!: GPUTextureFormat;
  /** Does the adapter support HDR */
  private hdrSupported = false;

  // Internal state management
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private context!: GPUCanvasContext;
  private adapter!: GPUAdapter;
  private instanceBuffer!: GPUBuffer;
  private depthTexture!: GPUTexture;
  private clusterBuilder!: ClusterBuilder;
  private dummyTexture!: GPUTexture;
  private dummyCubemapTexture!: GPUTexture;

  // Optimization managers
  private batchManager!: BatchManager;
  private uniformManager!: UniformManager;
  private shadowSubsystem!: ShadowSubsystem;

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

  // Pre-allocated arrays for render data
  private visibleRenderables: Renderable[] = [];
  private transparentRenderables: Renderable[] = [];
  private opaqueBatches: DrawBatch[] = [];

  private tempVec3A: Vec3 = vec3.create();
  private tempVec3B: Vec3 = vec3.create();
  private tempCameraPos: Vec3 = vec3.create();

  private stats: RendererStats = {
    canvasWidth: 0,
    canvasHeight: 0,
    lightCount: 0,
    visibleOpaque: 0,
    visibleTransparent: 0,
    drawsOpaque: 0,
    drawsTransparent: 0,
    instancesOpaque: 0,
    instancesTransparent: 0,
    cpuTotalUs: 0,
    clusterAvgLpcX1000: 0,
    clusterMaxLpc: 0,
    clusterOverflows: 0,
  };

  private resizeObserver?: ResizeObserver;
  private resizePending = true;
  private cssWidth = 0;
  private cssHeight = 0;
  private currentDPR = 1;

  // The number of f32 values for a single instance.
  // mat4(16) + flag(1) + 3 bytes of padding
  private static readonly INSTANCE_STRIDE_IN_FLOATS = 20; // 16 for mat4 + 4 for vec4 alignment of the next element

  // The byte size for a single instance.
  private static readonly INSTANCE_BYTE_STRIDE =
    Renderer.INSTANCE_STRIDE_IN_FLOATS * Float32Array.BYTES_PER_ELEMENT;

  public static readonly INSTANCE_DATA_LAYOUT: GPUVertexBufferLayout = {
    arrayStride: Renderer.INSTANCE_BYTE_STRIDE,
    stepMode: "instance",
    attributes: [
      // Model Matrix (mat4x4<f32>)
      { shaderLocation: 4, offset: 0, format: "float32x4" },
      { shaderLocation: 5, offset: 16, format: "float32x4" },
      { shaderLocation: 6, offset: 32, format: "float32x4" },
      { shaderLocation: 7, offset: 48, format: "float32x4" },
      // is_uniformly_scaled (u32) - u32 for clean packing
      {
        shaderLocation: 8,
        offset: 64, // 16 * 4
        format: "uint32",
      },
    ],
  };
  public static RENDER_SCALE = 1.0;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
  }

  /**
   * Initializes the renderer.
   *
   * This method sets up the WebGPU device and context, creates the depth
   * texture, and initializes the uniform buffers and other resources.
   * It must be called before any rendering can be done.
   */
  public async init(): Promise<void> {
    await this.setupDevice();

    // catch WebGPU validation errors
    this.device.addEventListener("uncapturederror", (event) => {
      console.error("[WebGPU Error]", event.error);
    });
    // Push error scope to catch pipeline creation errors
    this.device.pushErrorScope("validation");

    this.setupContext();

    // Create a default sampler
    this.defaultSampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });

    // Create a 1x1 white texture for non-textured materials
    this.dummyTexture = this.device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.dummyTexture },
      new Uint8Array([255, 255, 255, 255]), // White pixel
      { bytesPerRow: 4 },
      [1, 1],
    );

    // Create a 1x1x6 black cubemap for fallback
    this.dummyCubemapTexture = this.device.createTexture({
      label: "DUMMY_CUBEMAP",
      size: [1, 1, 6],
      format: "rgba16float",
      dimension: "2d",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    // Write black pixels to all 6 faces
    const blackPixel = new Float16Array([0, 0, 0, 0]);
    for (let i = 0; i < 6; i++) {
      this.device.queue.writeTexture(
        { texture: this.dummyCubemapTexture, origin: [0, 0, i] },
        blackPixel.buffer,
        { bytesPerRow: 8 },
        { width: 1, height: 1 },
      );
    }

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
      size: 128, // 2 * mat4x4<f32> (viewProjection + view)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.sceneDataBuffer = this.device.createBuffer({
      label: "SCENE_DATA_UNIFORM_BUFFER",
      size: 16 * 4, // 16 floats to match sceneDataArray in UniformManager
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.lightStorageBufferCapacity = 4;
    const lightStructSize = 12 * 4; // 12 floats per light
    const lightStorageBufferSize =
      16 + this.lightStorageBufferCapacity * lightStructSize;
    this.lightStorageBuffer = this.device.createBuffer({
      label: "LIGHT_STORAGE_BUFFER",
      size: lightStorageBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.clusterBuilder = new ClusterBuilder(this.device, {
      gridX: 16,
      gridY: 8,
      gridZ: 64,
      maxPerCluster: 128,
    });
    await this.clusterBuilder.init();

    this.frameBindGroupLayout = this.device.createBindGroupLayout({
      label: "FRAME_BIND_GROUP_LAYOUT",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        }, // camera
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        }, // lights
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        }, // scene
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        }, // cluster params
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        }, // cluster counts (read in fs)
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        }, // cluster indices (read in fs)
        {
          binding: 6,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "cube" },
        }, // irradiance map
        {
          binding: 7,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "cube" },
        }, // prefiltered map
        {
          binding: 8,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d" },
        }, // brdf LUT
        {
          binding: 9,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {},
        }, // ibl sampler
        {
          binding: 10,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "depth", viewDimension: "2d" },
        }, // shadow map (depth)
        {
          binding: 11,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "comparison" },
        }, // shadow compare sampler
        {
          binding: 12,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        }, // shadow uniforms (light VP, dir/color, params)
      ],
    });

    this.batchManager = new BatchManager(100);
    this.uniformManager = new UniformManager();
    this.frameInstanceData = new Float32Array(
      this.frameInstanceCapacity * Renderer.INSTANCE_STRIDE_IN_FLOATS,
    );

    // Initialize the shadow subsystem with current mesh/instance layouts
    this.shadowSubsystem = new ShadowSubsystem(this.device);
    await this.shadowSubsystem.init(
      // Use any mesh's layouts as a template; they are consistent across meshes.
      // We don't have meshes at init time; we can pass an example layout. Reuse the PBR layout expectation:
      [
        // Positions
        {
          arrayStride: 12,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
        // Normals
        {
          arrayStride: 12,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
        },
        // UV0
        {
          arrayStride: 8,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }],
        },
        // Tangents
        {
          arrayStride: 16,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 3, offset: 0, format: "float32x4" }],
        },
        // UV1
        {
          arrayStride: 8,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 9, offset: 0, format: "float32x2" }],
        },
      ],
      Renderer.INSTANCE_DATA_LAYOUT,
      "depth32float",
    );

    // Check for errors after init
    const error = await this.device.popErrorScope();
    if (error) {
      console.error("[WebGPU Validation Error during init]", error);
    }
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
   * External resize hook for worker-driven sizing.
   *
   * Computes physical size, updates canvas, depth texture, and camera aspect
   * immediately.
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

    // Check for HDR support
    const requiredFeatures: GPUFeatureName[] = [];
    if (this.adapter.features.has("shader-f16")) {
      this.hdrSupported = true;
      requiredFeatures.push("shader-f16");
      console.log("HDR rendering supported (shader-f16) and enabled.");
    } else {
      console.log("HDR rendering not supported by adapter.");
    }

    this.device = await this.adapter.requestDevice({
      requiredFeatures,
    });

    // Diagnostics: detect software fallback
    // Chrome implements isFallbackAdapter; if true, we're likely on SwiftShader (CPU).
    const anyAdapter = this.adapter as any;
    if (typeof anyAdapter.isFallbackAdapter === "boolean") {
      console.warn("WebGPU Adapter fallback:", anyAdapter.isFallbackAdapter);
    } else {
      console.warn("WebGPU Adapter fallback: unknown (property not available)");
    }
  }

  /**
   * Configures the WebGPU canvas context for rendering.
   *
   * This method obtains a "webgpu" GPUCanvasContext from the underlying
   * HTMLCanvasElement or OffscreenCanvas, chooses an appropriate canvas
   * format, and configures the swap chain. If HDR output is potentially
   * supported by the adapter (as detected during device setup), it first
   * attempts to configure the canvas with an HDR format (rgba16float)
   * and falls back to the preferred SDR format if that fails.
   *
   * Side effects:
   * - Initializes this.context with a GPUCanvasContext.
   * - Sets this.canvasFormat to the final format used by the swap chain.
   * - Calls GPUCanvasContext.configure() with the selected configuration.
   * - Logs the final canvas format selection.
   *
   * Error handling:
   * - On HDR configuration failure, logs a warning, disables the HDR path,
   *   and configures the context with SDR settings instead.
   *
   * Note:
   * - The presence of adapter features (ie "shader-f16") does not guarantee
   *   that a particular canvas format is supported. The code attempts HDR and
   *   gracefully falls back to SDR as needed.
   */
  private setupContext(): void {
    // OffscreenCanvas also supports 'webgpu' context in workers; use a safe cast.
    const canvasAny = this.canvas as any;
    this.context = canvasAny.getContext("webgpu") as GPUCanvasContext;

    // Default to the browser's preferred SDR format
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();

    const config: GPUCanvasConfiguration = {
      device: this.device,
      format: this.canvasFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: "premultiplied",
    };

    // Attempt to configure for HDR if the adapter indicates support.
    // If configuration fails at runtime, fall back to SDR.
    if (this.hdrSupported) {
      const hdrConfig: GPUCanvasConfiguration = {
        ...config,
        format: "rgba16float",
      };
      try {
        this.context.configure(hdrConfig);
        // If successful, record the HDR format.
        this.canvasFormat = "rgba16float";
        console.log("Successfully configured canvas for HDR output.");
      } catch (e) {
        console.warn(
          "HDR canvas configuration failed. Falling back to SDR.",
          e,
        );
        // Disable HDR path and configure standard SDR.
        this.hdrSupported = false;
        this.context.configure(config);
      }
    } else {
      // Adapter not HDR-capable (or we chose not to attempt HDR): configure SDR.
      this.context.configure(config);
    }

    // Diagnostic: log the final canvas format in use.
    console.log("[Renderer] Canvas configured with format:", this.canvasFormat);
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
    sceneData: SceneRenderData,
    sun?: SceneSunComponent,
    shadowSettings?: ShadowSettingsComponent,
  ): void {
    // Update sun shadow uniforms first (if available)
    if (sun && sun.enabled && shadowSettings) {
      this.shadowSubsystem.updatePerFrame(camera, sun, shadowSettings);
    } else {
      // No sun or disabled: ensure uniforms carry zero intensity so FS adds no sun term
      this.shadowSubsystem.writeDisabled();
    }

    // Camera + scene uniforms
    this.uniformManager.updateCameraUniform(
      this.device,
      this.cameraUniformBuffer,
      camera,
    );
    this.uniformManager.updateSceneUniform(
      this.device,
      this.sceneDataBuffer,
      camera,
      sceneData.fogEnabled,
      sceneData.fogColor,
      sceneData.fogDensity,
      sceneData.fogHeight,
      sceneData.fogHeightFalloff,
      sceneData.fogInscatteringIntensity,
      this.hdrSupported,
      sceneData.prefilteredMipLevels,
    );

    // Lights SSBO packing
    const lightCount = lights.length;
    const lightStructSize = 12 * 4; // 12 floats per light
    const lightDataBuffer = this.uniformManager.getLightDataBuffer(lightCount);

    if (lightCount > this.lightStorageBufferCapacity) {
      // Recreate GPU storage buffer
      this.lightStorageBuffer.destroy();
      this.lightStorageBufferCapacity = Math.ceil(lightCount * 1.5);
      const newSize = 16 + this.lightStorageBufferCapacity * lightStructSize;
      this.lightStorageBuffer = this.device.createBuffer({
        label: "LIGHT_STORAGE_BUFFER (resized)",
        size: newSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }

    // We create the frame bind group every frame. This is cheap
    // and ensures it's always valid and uses the latest resources.
    const ibl = sceneData.iblComponent;
    const shadowBindings = this.shadowSubsystem.getFrameBindings();

    this.frameBindGroup = this.device.createBindGroup({
      label: "FRAME_BIND_GROUP",
      layout: this.frameBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniformBuffer } },
        { binding: 1, resource: { buffer: this.lightStorageBuffer } },
        { binding: 2, resource: { buffer: this.sceneDataBuffer } },
        {
          binding: 3,
          resource: { buffer: this.clusterBuilder.clusterParamsBuffer },
        },
        {
          binding: 4,
          resource: { buffer: this.clusterBuilder.clusterCountsBuffer },
        },
        {
          binding: 5,
          resource: { buffer: this.clusterBuilder.clusterIndicesBuffer },
        },
        {
          binding: 6,
          resource: ibl
            ? ibl.irradianceMap.createView({ dimension: "cube" })
            : this.dummyCubemapTexture.createView({ dimension: "cube" }),
        },
        {
          binding: 7,
          resource: ibl
            ? ibl.prefilteredMap.createView({ dimension: "cube" })
            : this.dummyCubemapTexture.createView({ dimension: "cube" }),
        },
        {
          binding: 8,
          resource: ibl
            ? ibl.brdfLut.createView()
            : this.dummyTexture.createView(),
        },
        {
          binding: 9,
          resource: ibl ? ibl.sampler : this.defaultSampler,
        },
        { binding: 10, resource: shadowBindings.shadowMapView },
        { binding: 11, resource: shadowBindings.shadowSampler },
        {
          binding: 12,
          resource: { buffer: shadowBindings.shadowUniformBuffer },
        },
      ],
    });

    this.clusterBuilder.updateParams(
      camera,
      this.canvas.width,
      this.canvas.height,
    );
    // Ensure compute bind group references the current lights buffer
    this.clusterBuilder.createComputeBindGroup(this.lightStorageBuffer);

    // Header: u32 count + 3 pad u32 (16 bytes)
    const headerU32 = new Uint32Array(lightDataBuffer, 0, 4);
    headerU32[0] = lightCount;
    headerU32[1] = 0;
    headerU32[2] = 0;
    headerU32[3] = 0;

    // Body: [pos vec4][color vec4][params0 vec4] * N
    const lightDataView = new Float32Array(lightDataBuffer, 16);
    for (let i = 0; i < lightCount; i++) {
      const base = i * 12;
      lightDataView.set(lights[i].position, base + 0);
      lightDataView.set(lights[i].color, base + 4);
      lightDataView.set(lights[i].params0, base + 8);
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

  /**
   * Tests if a renderable object is within the camera's view frustum.
   * Uses AABB vs frustum planes testing for accurate culling.
   */
  private _isInFrustum(
    renderable: Renderable,
    camera: CameraComponent,
  ): boolean {
    // Transform mesh AABB to world space
    const worldAABB = transformAABB(
      renderable.mesh.aabb,
      renderable.modelMatrix,
    );

    // Test against frustum planes
    return testAABBFrustum(worldAABB, camera.frustumPlanes);
  }

  private ensureCpuInstanceCapacity(requiredInstances: number): void {
    if (requiredInstances <= this.frameInstanceCapacity) return;

    // Grow capacity with a 1.5x factor to reduce reallocations
    this.frameInstanceCapacity = Math.ceil(requiredInstances * 1.5);

    // We repack per frame, so we don't need to copy old contents
    this.frameInstanceData = new Float32Array(
      this.frameInstanceCapacity * Renderer.INSTANCE_STRIDE_IN_FLOATS,
    );
  }

  private _renderOpaquePass(
    passEncoder: GPURenderPassEncoder,
    batches: DrawBatch[],
  ): number {
    if (batches.length === 0) return 0;

    let lastMaterialInstance: MaterialInstance | null = null;
    let lastMesh: Mesh | null = null;

    for (const batch of batches) {
      const mesh = batch.mesh;
      passEncoder.setPipeline(batch.pipeline);

      if (batch.materialInstance !== lastMaterialInstance) {
        passEncoder.setBindGroup(1, batch.materialInstance.bindGroup);
        lastMaterialInstance = batch.materialInstance;
      }

      if (mesh !== lastMesh) {
        // Validate expected buffer count
        if (mesh.buffers.length !== mesh.layouts.length) {
          console.error(
            `[Renderer] Mesh buffer/layout mismatch: ${mesh.buffers.length} buffers, ${mesh.layouts.length} layouts`,
          );
        }

        // Bind vertex buffers in exact order
        for (let i = 0; i < mesh.buffers.length; i++) {
          passEncoder.setVertexBuffer(i, mesh.buffers[i]);
        }

        if (mesh.indexBuffer) {
          passEncoder.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat!);
        }
        lastMesh = mesh;
      }

      // Bind instance buffer to the slot after mesh buffers
      const instanceSlot = mesh.buffers.length; // Should be 4
      const instanceByteOffset =
        batch.firstInstance * Renderer.INSTANCE_BYTE_STRIDE;
      passEncoder.setVertexBuffer(
        instanceSlot,
        this.instanceBuffer,
        instanceByteOffset,
      );

      // Draw
      if (mesh.indexBuffer) {
        passEncoder.drawIndexed(mesh.indexCount!, batch.instanceCount, 0, 0, 0);
      } else {
        passEncoder.draw(mesh.vertexCount, batch.instanceCount, 0, 0);
      }
    }

    return batches.length;
  }

  private _renderTransparentPass(
    passEncoder: GPURenderPassEncoder,
    renderables: Renderable[],
    camera: CameraComponent,
    instanceBufferOffset: number, // bytes
  ): number {
    if (renderables.length === 0) return 0;

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

    const floatsPerInstance = Renderer.INSTANCE_STRIDE_IN_FLOATS;
    const instanceDataView = new Float32Array(
      this.frameInstanceData.buffer,
      instanceBufferOffset,
      renderables.length * floatsPerInstance,
    );
    const instanceUintView = new Uint32Array(
      instanceDataView.buffer,
      instanceDataView.byteOffset,
    );

    for (let i = 0; i < renderables.length; i++) {
      const { modelMatrix, isUniformlyScaled, receiveShadows } = renderables[i];
      const floatOff = i * floatsPerInstance;
      const uintOff = floatOff;

      // Model matrix
      instanceDataView.set(modelMatrix, floatOff);

      const flags =
        (isUniformlyScaled ? 1 : 0) | (((receiveShadows ?? true) ? 1 : 0) << 1);
      instanceUintView[uintOff + 16] = flags;
    }

    // Upload instance data for transparent objects
    this.device.queue.writeBuffer(
      this.instanceBuffer,
      instanceBufferOffset,
      instanceDataView,
    );

    // Draw, batching consecutive renderables with same mesh and material instance
    let drawCalls = 0;
    let i = 0;
    while (i < renderables.length) {
      const { mesh, material } = renderables[i];
      const pipeline = material.material.getPipeline(
        mesh.layouts,
        Renderer.INSTANCE_DATA_LAYOUT,
        this.frameBindGroupLayout,
        this.canvasFormat,
        this.depthFormat,
      );

      // Count consecutive instances with same mesh and material instance
      let count = 1;
      while (
        i + count < renderables.length &&
        renderables[i + count].mesh === mesh &&
        renderables[i + count].material === material
      ) {
        count++;
      }

      // Bind pipeline and resources per group
      passEncoder.setPipeline(pipeline);
      passEncoder.setBindGroup(1, material.bindGroup);

      // Bind mesh vertex buffers
      for (let j = 0; j < mesh.buffers.length; j++) {
        passEncoder.setVertexBuffer(j, mesh.buffers[j]);
      }

      // Bind the instance buffer with a per-group byte offset and size
      const groupByteOffset =
        instanceBufferOffset + i * Renderer.INSTANCE_BYTE_STRIDE;
      passEncoder.setVertexBuffer(
        mesh.layouts.length,
        this.instanceBuffer,
        groupByteOffset,
      );

      if (mesh.indexBuffer) {
        passEncoder.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat!);
        passEncoder.drawIndexed(mesh.indexCount!, count, 0, 0, 0);
      } else {
        passEncoder.draw(mesh.vertexCount, count, 0, 0);
      }

      drawCalls++;
      i += count;
    }

    return drawCalls;
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

  private validateMeshPipelineCompatibility(
    mesh: Mesh,
    material: Material,
  ): void {
    console.group(`[Renderer] Validating mesh-pipeline compatibility`);
    console.log(`Mesh has ${mesh.buffers.length} buffers:`);

    for (let i = 0; i < mesh.layouts.length; i++) {
      const layout = mesh.layouts[i];
      const attrs = layout.attributes
        .map((a) => `@location(${a.shaderLocation}) ${a.format}`)
        .join(", ");
      console.log(
        `  Slot ${i}: stride=${layout.arrayStride}, attrs=[${attrs}]`,
      );
    }

    console.log(`Material ${material.id} expects these shader inputs`);
    console.log(`Instance data will bind to slot ${mesh.layouts.length}`);
    console.groupEnd();
  }

  /**
   * Renders a single frame.
   *
   * This method performs frustum culling, batching, and sorting of renderable
   * objects, and then records and submits the necessary render passes to the
   * GPU.
   * @param camera The camera to render from.
   * @param sceneData The data for the scene to render.
   * @param postSceneDrawCallback An optional callback to render UI or other
   * content after the main scene has been drawn.
   */
  public render(
    camera: CameraComponent,
    sceneData: SceneRenderData,
    postSceneDrawCallback?: (scenePassEncoder: GPURenderPassEncoder) => void,
    sun?: SceneSunComponent,
    shadowSettings?: ShadowSettingsComponent,
  ): void {
    const tStart = performance.now();

    Profiler.begin("Render.Total");
    Profiler.begin("Render.HandleResize");
    this._handleResize(camera);
    Profiler.end("Render.HandleResize");

    if (this.canvas.width === 0 || this.canvas.height === 0) {
      this.stats.canvasWidth = this.canvas.width;
      this.stats.canvasHeight = this.canvas.height;
      this.stats.cpuTotalUs = Math.max(
        0,
        Math.round((performance.now() - tStart) * 1000),
      );
      Profiler.end("Render.Total");
      return;
    }

    // Update all frame uniforms, including shadow matrices. This creates the frameBindGroup.
    Profiler.begin("Render.UpdateUniforms");
    this._updateFrameUniforms(
      camera,
      sceneData.lights,
      sceneData,
      sun,
      shadowSettings,
    );
    Profiler.end("Render.UpdateUniforms");

    // Frustum cull and separate opaque/transparent lists for the main camera view.
    Profiler.begin("Render.FrustumCullAndSeparate");
    this.visibleRenderables.length = 0;
    this.transparentRenderables.length = 0;
    for (const r of sceneData.renderables) {
      if (this._isInFrustum(r, camera)) {
        if (r.material.material.isTransparent) {
          this.transparentRenderables.push(r);
        } else {
          this.visibleRenderables.push(r);
        }
      }
    }
    this.stats.visibleOpaque = this.visibleRenderables.length;
    this.stats.visibleTransparent = this.transparentRenderables.length;
    this.stats.lightCount = sceneData.lights.length;
    this.stats.canvasWidth = this.canvas.width;
    this.stats.canvasHeight = this.canvas.height;
    const cls = this.clusterBuilder.getLastStats();
    this.stats.clusterAvgLpcX1000 = cls.avgLpcX1000;
    this.stats.clusterMaxLpc = cls.maxLpc;
    this.stats.clusterOverflows = cls.overflow;
    Profiler.end("Render.FrustumCullAndSeparate");

    // --- Prepare Shadow Casters ---
    const shadowCasters =
      sun && sun.enabled && sun.castsShadows && shadowSettings
        ? sceneData.renderables.filter(
            (r) =>
              r.castShadows !== false && !r.material.material.isTransparent,
          )
        : [];
    const shadowCasterCount = shadowCasters.length;

    // --- Prepare Main Pass Renderables ---
    const opaqueInstanceTotal = this.visibleRenderables.length;
    const transparentInstanceTotal = this.transparentRenderables.length;

    // --- Ensure GPU/CPU Buffers are large enough for EITHER pass ---
    const requiredInstanceCapacity = Math.max(
      shadowCasterCount,
      opaqueInstanceTotal + transparentInstanceTotal,
    );
    this.ensureCpuInstanceCapacity(requiredInstanceCapacity);
    this._prepareInstanceBuffer(requiredInstanceCapacity);

    // --- Command Buffers for the frame ---
    const commandBuffers: GPUCommandBuffer[] = [];

    // 1. Cluster Compute Pass
    const clusterEncoder = this.device.createCommandEncoder({
      label: "CLUSTER_COMMAND_ENCODER",
    });
    this.clusterBuilder.record(clusterEncoder, this.stats.lightCount);
    commandBuffers.push(clusterEncoder.finish());

    // 2. Shadow Pass
    if (shadowCasterCount > 0 && shadowSettings) {
      Profiler.begin("Render.ShadowPass");
      const shadowEncoder = this.device.createCommandEncoder({
        label: "SHADOW_COMMAND_ENCODER",
      });
      // Pack and upload instance data for shadow casters
      const floatsPerInstance = Renderer.INSTANCE_STRIDE_IN_FLOATS;
      const u32 = new Uint32Array(this.frameInstanceData.buffer);
      for (let i = 0; i < shadowCasterCount; i++) {
        const floatOffset = i * floatsPerInstance;
        this.frameInstanceData.set(shadowCasters[i].modelMatrix, floatOffset);
        const flags =
          (shadowCasters[i].isUniformlyScaled ? 1 : 0) |
          ((shadowCasters[i].receiveShadows !== false ? 1 : 0) << 1);
        u32[floatOffset + 16] = flags;
      }
      this.device.queue.writeBuffer(
        this.instanceBuffer,
        0,
        this.frameInstanceData.buffer,
        0,
        shadowCasterCount * Renderer.INSTANCE_BYTE_STRIDE,
      );

      // Record the pass
      this.shadowSubsystem.recordShadowPass(
        shadowEncoder,
        shadowSettings.mapSize,
        shadowCasters,
        this.instanceBuffer,
      );
      commandBuffers.push(shadowEncoder.finish());
      Profiler.end("Render.ShadowPass");
    }

    // --- Main Command Encoder for Scene and UI ---
    const mainEncoder = this.device.createCommandEncoder({
      label: "MAIN_COMMAND_ENCODER",
    });

    // 3. Main Scene Pass
    // Get or build opaque batches
    Profiler.begin("Render.Batching");
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

    // Pack opaque instance data and create draw batches
    this.opaqueBatches.length = 0;
    let currentInstanceOffset = 0;
    for (const [, pipelineBatch] of opaquePipelineBatches.entries()) {
      for (const drawGroup of pipelineBatch.drawGroups) {
        if (drawGroup.instances.length === 0) continue;

        this.opaqueBatches.push({
          pipeline: getPipelineCallback(
            drawGroup.materialInstance.material,
            drawGroup.mesh,
          ),
          materialInstance: drawGroup.materialInstance,
          mesh: drawGroup.mesh,
          instanceCount: drawGroup.instances.length,
          firstInstance: currentInstanceOffset,
        });

        for (const instance of drawGroup.instances) {
          const floatOffset =
            currentInstanceOffset * Renderer.INSTANCE_STRIDE_IN_FLOATS;
          this.frameInstanceData.set(instance.modelMatrix, floatOffset);
          const u32 = new Uint32Array(this.frameInstanceData.buffer);
          const flags =
            (instance.isUniformlyScaled ? 1 : 0) |
            ((instance.receiveShadows ? 1 : 0) << 1);
          u32[floatOffset + 16] = flags;
          currentInstanceOffset++;
        }
      }
    }
    this.stats.instancesOpaque = opaqueInstanceTotal;
    this.stats.instancesTransparent = transparentInstanceTotal;
    Profiler.end("Render.Batching");

    // Upload instance data for the main pass (opaque part)
    Profiler.begin("Render.WriteInstanceBuffer");
    if (opaqueInstanceTotal > 0) {
      this.device.queue.writeBuffer(
        this.instanceBuffer,
        0,
        this.frameInstanceData.buffer,
        0,
        opaqueInstanceTotal * Renderer.INSTANCE_BYTE_STRIDE,
      );
    }
    Profiler.end("Render.WriteInstanceBuffer");

    // --- Begin Main Render Pass ---
    const textureView = this.context.getCurrentTexture().createView();
    const hasStencil =
      this.depthFormat === "depth24plus-stencil8" ||
      (this.depthFormat as string) === "depth32float-stencil8";

    const depthAttachment: GPURenderPassDepthStencilAttachment = {
      view: this.depthTexture.createView(),
      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    };
    if (hasStencil) {
      depthAttachment.stencilClearValue = 0;
      depthAttachment.stencilLoadOp = "clear";
      depthAttachment.stencilStoreOp = "discard";
    }

    const scenePassEncoder = mainEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: {
            r: sceneData.fogColor[0],
            g: sceneData.fogColor[1],
            b: sceneData.fogColor[2],
            a: sceneData.fogColor[3],
          },
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

    // Draw Skybox
    if (sceneData.skyboxMaterial) {
      const skyboxMatInstance = sceneData.skyboxMaterial;
      const pipeline = skyboxMatInstance.material.getPipeline(
        [],
        Renderer.INSTANCE_DATA_LAYOUT,
        this.frameBindGroupLayout,
        this.canvasFormat,
        this.depthFormat,
      );
      scenePassEncoder.setPipeline(pipeline);
      scenePassEncoder.setBindGroup(1, skyboxMatInstance.bindGroup);
      scenePassEncoder.draw(3, 1, 0, 0);
    }

    // Draw Opaque
    Profiler.begin("Render.OpaquePass");
    this.stats.drawsOpaque = this._renderOpaquePass(
      scenePassEncoder,
      this.opaqueBatches,
    );
    Profiler.end("Render.OpaquePass");

    // Draw Transparent
    Profiler.begin("Render.TransparentPass");
    this.stats.drawsTransparent = this._renderTransparentPass(
      scenePassEncoder,
      this.transparentRenderables,
      camera,
      opaqueInstanceTotal * Renderer.INSTANCE_BYTE_STRIDE,
    );
    Profiler.end("Render.TransparentPass");

    scenePassEncoder.end();

    // 4. UI Pass
    if (postSceneDrawCallback) {
      this._renderUIPass(mainEncoder, textureView, postSceneDrawCallback);
    }

    commandBuffers.push(mainEncoder.finish());

    // 5. Submit all recorded commands
    Profiler.begin("Render.Submit");
    this.device.queue.submit(commandBuffers);
    this.clusterBuilder.onSubmitted();
    Profiler.end("Render.Submit");

    this.stats.cpuTotalUs = Math.max(
      0,
      Math.round((performance.now() - tStart) * 1000),
    );
    Profiler.end("Render.Total");
  }

  /**
   * Returns the CSS size of the viewport.
   */
  public getViewportCssSize(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  /**
   * Returns the frame bind group layout.
   *
   * This layout defines the structure of the bind group that is used for
   * frame-level uniforms, such as the camera and lights.
   */
  public getFrameBindGroupLayout(): GPUBindGroupLayout {
    if (!this.frameBindGroupLayout)
      throw new Error(
        "Frame bind group layout is not initialized. Call init() first.",
      );
    return this.frameBindGroupLayout;
  }

  /**
   * Returns the rendering statistics for the last frame.
   */
  public getStats(): RendererStats {
    return this.stats;
  }
}

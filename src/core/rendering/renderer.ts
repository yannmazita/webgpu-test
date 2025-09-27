// src/core/renderer.ts
import { Light, Mesh, Renderable } from "@/core/types/gpu";
import { Material } from "@/core/materials/material";
import { SceneRenderData } from "@/core/types/rendering";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { BatchManager } from "@/core/rendering/batchManager";
import { UniformManager } from "@/core/rendering/uniformManager";
import { Profiler } from "@/core/utils/profiler";
import { testAABBFrustum, transformAABB } from "@/core/utils/bounds";
import { ClusterPass } from "@/core/rendering/passes/clusterPass";
import { ShadowPass } from "@/core/rendering/passes/shadowPass";
import { SkyboxPass } from "@/core/rendering/passes/skyboxPass";
import { DrawBatch, RendererStats } from "@/core/types/renderer";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/sunComponent";
import { OpaquePass } from "@/core/rendering/passes/opaquePass";
import { TransparentPass } from "@/core/rendering/passes/transparentPass";
import { UIPass } from "@/core/rendering/passes/uiPass";

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
  private dummyTexture!: GPUTexture;
  private dummyCubemapTexture!: GPUTexture;

  // Optimization managers
  private batchManager!: BatchManager;
  private uniformManager!: UniformManager;

  // Rendering passes
  private clusterPass!: ClusterPass;
  private shadowPass!: ShadowPass;
  private skyboxPass!: SkyboxPass;
  private opaquePass!: OpaquePass;
  private transparentPass!: TransparentPass;
  private uiPass!: UIPass;

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

  // Frame synchronization
  private frameInProgress = false;
  private pendingResize: {
    width: number;
    height: number;
    camera: CameraComponent;
  } | null = null;

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

  // UI-driven rendering flag
  private toneMappingEnabled = true;

  // The number of f32 values for a single instance.
  // mat4(16) + flag(1) + 3 bytes of padding
  public static readonly INSTANCE_STRIDE_IN_FLOATS = 20; // 16 for mat4 + 4 for vec4 alignment of the next element

  // The byte size for a single instance.
  public static readonly INSTANCE_BYTE_STRIDE =
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

    // The worker has an OffscreenCanvas, so its initial size is what's passed in.
    // The main thread will send a RESIZE message to correct it.
    this.depthFormat = "depth24plus";
    this.createDepthTexture();

    this.cameraUniformBuffer = this.device.createBuffer({
      label: "CAMERA_UNIFORM_BUFFER",
      size: 192, // 3 * mat4x4<f32> (viewProjection + view + inverseViewProjection)
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

    this.clusterPass = new ClusterPass(this.device);
    await this.clusterPass.init();

    this.shadowPass = new ShadowPass(this.device);
    await this.shadowPass.init();

    this.skyboxPass = new SkyboxPass();
    this.opaquePass = new OpaquePass();
    this.transparentPass = new TransparentPass(this.device);
    this.uiPass = new UIPass();

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
          texture: { sampleType: "depth", viewDimension: "2d-array" },
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

    // Check for errors after init
    const error = await this.device.popErrorScope();
    if (error) {
      console.error("[WebGPU Validation Error during init]", error);
    }
  }

  /**
   * Enables or disables ACES tone mapping in shaders.
   * This is a UI-driven toggle and does not reconfigure the canvas.
   */
  public setToneMappingEnabled(enabled: boolean): void {
    this.toneMappingEnabled = !!enabled;
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
    const dpr = (devicePixelRatio || 1) * Renderer.RENDER_SCALE;
    const physW = Math.max(1, Math.round(cssWidth * dpr));
    const physH = Math.max(1, Math.round(cssHeight * dpr));

    // Skip if size hasn't changed
    if (this.canvas.width === physW && this.canvas.height === physH) {
      return;
    }

    // Queue resize if frame is in progress
    if (this.frameInProgress) {
      this.pendingResize = {
        width: physW,
        height: physH,
        camera,
      };
      console.log(
        `[Renderer] Resize queued (frame in progress): ${physW}x${physH}`,
      );
      return;
    }

    // Apply resize immediately if no frame is active
    this._applyResize(physW, physH, camera);
  }

  private _applyResize(
    width: number,
    height: number,
    camera: CameraComponent,
  ): void {
    console.log(`[Renderer] Applying resize: ${width}x${height}`);

    // Update canvas size
    this.canvas.width = width;
    this.canvas.height = height;

    // Recreate depth texture
    this.createDepthTexture();

    // Update camera aspect ratio
    camera.setPerspective(
      camera.fovYRadians,
      width / height,
      camera.near,
      camera.far,
    );

    // Clear pending resize
    this.pendingResize = null;
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
    const adapterWithFallback = this.adapter as GPUAdapter & {
      isFallbackAdapter?: boolean;
    };
    if (typeof adapterWithFallback.isFallbackAdapter === "boolean") {
      console.warn(
        "WebGPU Adapter fallback:",
        adapterWithFallback.isFallbackAdapter,
      );
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
    const context = (this.canvas as HTMLCanvasElement).getContext("webgpu");
    if (!context) {
      throw new Error("Failed to get WebGPU context");
    }
    this.context = context;

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

  private _updateFrameUniforms(
    camera: CameraComponent,
    lights: Light[],
    sceneData: SceneRenderData,
    sun?: SceneSunComponent,
    shadowSettings?: ShadowSettingsComponent,
  ): void {
    this.shadowPass.updatePerFrame(camera, sun, shadowSettings);

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
      this.toneMappingEnabled,
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

    const ibl = sceneData.iblComponent;
    const shadowBindings = this.shadowPass
      .getShadowSubsystem()
      .getFrameBindings();
    const clusterBuilder = this.clusterPass.getClusterBuilder();

    this.frameBindGroup = this.device.createBindGroup({
      label: "FRAME_BIND_GROUP",
      layout: this.frameBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniformBuffer } },
        { binding: 1, resource: { buffer: this.lightStorageBuffer } },
        { binding: 2, resource: { buffer: this.sceneDataBuffer } },
        {
          binding: 3,
          resource: { buffer: clusterBuilder.clusterParamsBuffer },
        },
        {
          binding: 4,
          resource: { buffer: clusterBuilder.clusterCountsBuffer },
        },
        {
          binding: 5,
          resource: { buffer: clusterBuilder.clusterIndicesBuffer },
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

  /**
   * Returns whether the renderer has been initialized.
   */
  public isInitialized(): boolean {
    return !!this.device && !!this.context && !!this.frameBindGroupLayout;
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
    if (!this.isInitialized()) {
      console.warn("[Renderer] Render called before initialization complete");
      return;
    }
    const tStart = performance.now();

    Profiler.begin("Render.Total");
    Profiler.begin("Render.HandleResize");
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

    Profiler.begin("Render.UpdateUniforms");
    this._updateFrameUniforms(
      camera,
      sceneData.lights,
      sceneData,
      sun,
      shadowSettings,
    );
    Profiler.end("Render.UpdateUniforms");

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
    this.clusterPass.updateStats(this.stats);
    Profiler.end("Render.FrustumCullAndSeparate");

    const shadowCasters =
      sun && sun.enabled && sun.castsShadows && shadowSettings
        ? sceneData.renderables.filter(
            (r) =>
              r.castShadows !== false && !r.material.material.isTransparent,
          )
        : [];
    const shadowCasterCount = shadowCasters.length;

    const opaqueInstanceTotal = this.visibleRenderables.length;
    const transparentInstanceTotal = this.transparentRenderables.length;

    const requiredInstanceCapacity = Math.max(
      shadowCasterCount,
      opaqueInstanceTotal + transparentInstanceTotal,
    );
    this.ensureCpuInstanceCapacity(requiredInstanceCapacity);
    this._prepareInstanceBuffer(requiredInstanceCapacity);

    const commandBuffers: GPUCommandBuffer[] = [];

    const clusterEncoder = this.device.createCommandEncoder({
      label: "CLUSTER_COMMAND_ENCODER",
    });
    this.clusterPass.record(
      clusterEncoder,
      this.stats.lightCount,
      camera,
      this.canvas.width,
      this.canvas.height,
      this.lightStorageBuffer,
    );
    commandBuffers.push(clusterEncoder.finish());

    if (shadowCasterCount > 0 && shadowSettings) {
      Profiler.begin("Render.ShadowPass");
      const shadowEncoder = this.device.createCommandEncoder({
        label: "SHADOW_COMMAND_ENCODER",
      });
      this.shadowPass.record(
        shadowEncoder,
        shadowCasters,
        shadowSettings,
        this.instanceBuffer,
        this.frameInstanceData,
      );
      commandBuffers.push(shadowEncoder.finish());
      Profiler.end("Render.ShadowPass");
    }

    const mainEncoder = this.device.createCommandEncoder({
      label: "MAIN_COMMAND_ENCODER",
    });

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

    if (sceneData.skyboxMaterial) {
      this.skyboxPass.record(
        scenePassEncoder,
        sceneData.skyboxMaterial,
        this.frameBindGroupLayout,
        this.canvasFormat,
        this.depthFormat,
      );
    }

    Profiler.begin("Render.OpaquePass");
    this.stats.drawsOpaque = this.opaquePass.record(
      scenePassEncoder,
      this.opaqueBatches,
      this.instanceBuffer,
    );
    Profiler.end("Render.OpaquePass");

    Profiler.begin("Render.TransparentPass");
    this.stats.drawsTransparent = this.transparentPass.record(
      scenePassEncoder,
      this.transparentRenderables,
      camera,
      this.instanceBuffer,
      opaqueInstanceTotal * Renderer.INSTANCE_BYTE_STRIDE,
      this.frameInstanceData,
      this.frameBindGroupLayout,
      this.canvasFormat,
      this.depthFormat,
    );
    Profiler.end("Render.TransparentPass");

    scenePassEncoder.end();

    if (postSceneDrawCallback) {
      this.uiPass.record(
        mainEncoder,
        textureView,
        this.canvas.width,
        this.canvas.height,
        postSceneDrawCallback,
      );
    }

    commandBuffers.push(mainEncoder.finish());

    Profiler.begin("Render.Submit");
    this.device.queue.submit(commandBuffers);
    this.clusterPass.onSubmitted();
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

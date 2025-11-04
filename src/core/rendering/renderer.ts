// src/core/rendering/renderer.ts
import { Light, Renderable } from "@/core/types/gpu";
import { SceneRenderData, RenderContext } from "@/core/types/rendering";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { UniformManager } from "@/core/rendering/uniformManager";
import { Profiler } from "@/core/utils/profiler";
import { testAABBFrustum, transformAABB } from "@/core/utils/bounds";
import { ClusterPass } from "@/core/rendering/passes/clusterPass";
import { ShadowPass } from "@/core/rendering/passes/shadowPass";
import { SkyboxPass } from "@/core/rendering/passes/skyboxPass";
import { RendererStats } from "@/core/types/renderer";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/sunComponent";
import { OpaquePass } from "@/core/rendering/passes/opaquePass";
import { TransparentPass } from "@/core/rendering/passes/transparentPass";
import { InstanceBufferManager } from "@/core/rendering/instanceBufferManager";

/**
 * The central rendering engine for the application.
 *
 * @remarks
 * This class is the primary orchestrator of the entire rendering process. Its
 * core responsibilities include initializing the WebGPU device and context,
 * managing global frame-level GPU resources (like uniform buffers and the
 * frame bind group), and executing the main render loop each frame.
 *
 * The rendering architecture is based on a sequence of self-contained render
 * passes. The `Renderer` prepares a single, immutable `RenderContext` object
 * for each frame, which contains all the necessary scene data and resources.
 * This context is then passed to each `RenderPass` in sequence, allowing them
 * to perform their specific tasks (ie shadow mapping, light clustering,
 * opaque geometry rendering) independently.
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
  private depthTexture!: GPUTexture;
  private dummyTexture!: GPUTexture;
  private dummyCubemapTexture!: GPUTexture;

  // Optimization managers
  private uniformManager!: UniformManager;
  private instanceBufferManager!: InstanceBufferManager;

  // Rendering passes
  private clusterPass!: ClusterPass;
  private shadowPass!: ShadowPass;
  private skyboxPass!: SkyboxPass;
  private opaquePass!: OpaquePass;
  private transparentPass!: TransparentPass;

  // Per-frame data
  private frameBindGroupLayout!: GPUBindGroupLayout;
  private frameBindGroup!: GPUBindGroup;
  private cameraUniformBuffer!: GPUBuffer;
  private sceneDataBuffer!: GPUBuffer;
  private lightStorageBuffer!: GPUBuffer;
  private lightStorageBufferCapacity!: number;

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

  private resizeObserver?: ResizeObserver;
  private resizePending = true;
  private cssWidth = 0;
  private cssHeight = 0;
  private currentDPR = 1;

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
   * Initializes the renderer and all its core WebGPU resources.
   *
   * @remarks
   * This asynchronous method must be called and awaited before any rendering
   * can occur. It performs several critical setup steps:
   * - Requests the `GPUDevice` and `GPUCanvasContext`.
   * - Creates default fallback resources like a 1x1 white texture and a
   *   default sampler.
   * - Sets up a `ResizeObserver` to handle canvas resizing automatically.
   * - Creates the core uniform buffers for camera, scene, and light data.
   * - Initializes all the individual `RenderPass` instances.
   * - Creates the global `frameBindGroupLayout` that defines the structure of
   *   shared, frame-level resources for all shaders.
   * - Initializes helper managers like `UniformManager` and `InstanceBufferManager`.
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
      addressModeU: "repeat",
      addressModeV: "repeat",
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
    this.transparentPass = new TransparentPass();

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

    this.uniformManager = new UniformManager();
    this.instanceBufferManager = new InstanceBufferManager(this.device);

    // Check for errors after init
    const error = await this.device.popErrorScope();
    if (error) {
      console.error("[WebGPU Validation Error during init]", error);
    }
  }

  /**
   * Enables or disables ACES tone mapping in the PBR shader.
   *
   * @remarks
   * This method updates a uniform flag that is read by the PBR fragment
   * shader. It provides a simple toggle for the tone mapping effect without
   * needing to reconfigure any render pipelines.
   *
   * @param enabled Whether tone mapping should be active.
   */
  public setToneMappingEnabled(enabled: boolean): void {
    this.toneMappingEnabled = !!enabled;
  }

  private _setupResizeObserver(): void {
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === this.canvas) {
            const cr = entry.contentRect;
            this.cssWidth = Math.max(0, Math.floor(cr.width));
            this.cssHeight = Math.max(0, Math.floor(cr.height));
            this.resizePending = true;
          }
        }
      });
      // Only observe if DOM canvas
      if (
        typeof (this.canvas as HTMLCanvasElement).getBoundingClientRect ===
        "function"
      ) {
        this.resizeObserver.observe(this.canvas as HTMLCanvasElement);
      }
    }
    // Only attach window listener in main thread
    if (typeof window !== "undefined" && window && window.addEventListener) {
      window.addEventListener("resize", () => {
        this.currentDPR = window.devicePixelRatio || 1;
        const rect =
          typeof (this.canvas as HTMLCanvasElement).getBoundingClientRect ===
          "function"
            ? (this.canvas as HTMLCanvasElement).getBoundingClientRect()
            : { width: this.cssWidth, height: this.cssHeight };
        this.cssWidth = Math.max(0, Math.floor(rect.width));
        this.cssHeight = Math.max(0, Math.floor(rect.height));
        this.resizePending = true;
      });
    }
  }

  /**
   * Handles resizing of the canvas.
   *
   * @remarks
   * This method is used when a `ResizeObserver` is not available, such as in a
   * Web Worker. It directly sets the canvas's physical dimensions, recreates
   * the depth texture to match, and updates the active camera's aspect ratio.
   *
   * @param cssWidth The new width of the canvas in CSS pixels.
   * @param cssHeight The new height of the canvas in CSS pixels.
   * @param devicePixelRatio The device's current pixel ratio.
   * @param camera The camera whose aspect ratio needs to be updated.
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
    if (this.canvas.width !== physW || this.canvas.height !== physH) {
      this.canvas.width = physW;
      this.canvas.height = physH;
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

  /**
   * Renders a single frame of the scene.
   *
   * @remarks
   * This is the main entry point for the render loop. It orchestrates the
   * entire frame pipeline in this sequence:
   *
   * @param camera The camera to render from.
   * @param sceneData The data for the scene to render.
   * @param commandEncoder
   * @param sun The scene's directional sun component.
   * @param shadowSettings The current shadow quality settings.
   */
  public render(
    camera: CameraComponent,
    sceneData: SceneRenderData,
    commandEncoder: GPUCommandEncoder,
    sun?: SceneSunComponent,
    shadowSettings?: ShadowSettingsComponent,
  ): void {
    const tStart = performance.now();
    Profiler.begin("Render.Total");

    this._handleResize(camera);

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

    this._updateFrameUniforms(
      camera,
      sceneData.lights,
      sceneData,
      sun,
      shadowSettings,
    );

    const visibleRenderables = sceneData.renderables.filter((r) =>
      this._isInFrustum(r, camera),
    );

    const opaqueRenderables = visibleRenderables.filter(
      (r) => !r.material.material.isTransparent,
    );
    const transparentRenderables = visibleRenderables.filter(
      (r) => r.material.material.isTransparent,
    );
    const shadowCasters =
      sun && sun.enabled && sun.castsShadows && shadowSettings
        ? sceneData.renderables.filter(
            (r) =>
              r.castShadows !== false && !r.material.material.isTransparent,
          )
        : [];

    const instanceAllocations = this.instanceBufferManager.packAndUpload(
      shadowCasters,
      opaqueRenderables,
      transparentRenderables,
    );

    const context: RenderContext = {
      sceneData: { ...sceneData, renderables: visibleRenderables },
      camera,
      sun,
      shadowSettings,
      device: this.device,
      commandEncoder,
      canvasView: this.context.getCurrentTexture().createView(),
      depthView: this.depthTexture.createView(),
      canvasFormat: this.canvasFormat,
      depthFormat: this.depthFormat,
      frameBindGroup: this.frameBindGroup,
      frameBindGroupLayout: this.frameBindGroupLayout,
      lightStorageBuffer: this.lightStorageBuffer,
      instanceBuffer: this.instanceBufferManager.getBuffer(),
      instanceAllocations,
      clusterBuilder: this.clusterPass.getClusterBuilder(),
      shadowSubsystem: this.shadowPass.getShadowSubsystem(),
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
    };

    // Execute compute passes first
    this.clusterPass.execute(context);
    this.shadowPass.execute(context);

    // Now execute render passes
    const hasStencil =
      this.depthFormat === "depth24plus-stencil8" ||
      (this.depthFormat as string) === "depth32float-stencil8";
    const depthAttachment: GPURenderPassDepthStencilAttachment = {
      view: context.depthView,
      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    };
    if (hasStencil) {
      depthAttachment.stencilClearValue = 0;
      depthAttachment.stencilLoadOp = "clear";
      depthAttachment.stencilStoreOp = "discard";
    }

    const scenePassEncoder = context.commandEncoder.beginRenderPass({
      label: "MAIN_SCENE_PASS",
      colorAttachments: [
        {
          view: context.canvasView,
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
      context.canvasWidth,
      context.canvasHeight,
      0,
      1,
    );
    scenePassEncoder.setBindGroup(0, context.frameBindGroup);

    this.skyboxPass.execute(context, scenePassEncoder);
    this.stats.drawsOpaque = this.opaquePass.execute(context, scenePassEncoder);
    this.stats.drawsTransparent = this.transparentPass.execute(
      context,
      scenePassEncoder,
    );

    scenePassEncoder.end();

    // Update stats
    this.stats.visibleOpaque = opaqueRenderables.length;
    this.stats.visibleTransparent = transparentRenderables.length;
    this.stats.instancesOpaque = opaqueRenderables.length;
    this.stats.instancesTransparent = transparentRenderables.length;
    this.stats.lightCount = sceneData.lights.length;
    this.stats.canvasWidth = context.canvasWidth;
    this.stats.canvasHeight = context.canvasHeight;
    this.clusterPass.updateStats(this.stats);
    this.stats.cpuTotalUs = Math.max(
      0,
      Math.round((performance.now() - tStart) * 1000),
    );
    Profiler.end("Render.Total");
  }

  /**
   * Notifies internal subsystems that the frame's command buffer has been submitted.
   * @remarks
   * This must be called after `device.queue.submit()` to allow subsystems like
   * the cluster builder to safely initiate asynchronous GPU readback operations.
   */
  public onFrameSubmitted(): void {
    this.clusterPass.onSubmitted();
  }

  /**
   * Gets the default 1x1 white fallback texture.
   * @returns The fallback GPUTexture.
   */
  public getDummyTexture(): GPUTexture {
    return this.dummyTexture;
  }

  /**
   * Gets the default texture sampler.
   * @returns The default GPUSampler.
   */
  public getDefaultSampler(): GPUSampler {
    return this.defaultSampler;
  }

  public getCanvas(): HTMLCanvasElement | OffscreenCanvas {
    return this.canvas;
  }

  public getContext(): GPUCanvasContext {
    return this.context;
  }

  /**
   * Returns the rendering statistics for the most recently completed frame.
   *
   * @returns An object containing performance metrics like draw counts,
   *   instance counts, and CPU timings.
   */
  public getStats(): RendererStats {
    return this.stats;
  }
}

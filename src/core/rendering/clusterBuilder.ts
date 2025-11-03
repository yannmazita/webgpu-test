// src/core/rendering/clusterBuilder.ts
import clusterUrl from "@/core/shaders/cluster.wgsl?url";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";

/**
 * Defines the configuration for the 3D cluster grid.
 */
export interface ClusterConfig {
  /** The number of clusters along the X-axis of the screen. */
  gridX: number;
  /** The number of clusters along the Y-axis of the screen. */
  gridY: number;
  /** The number of clusters along the Z-axis (depth) of the view frustum. */
  gridZ: number;
  /** The maximum number of lights that can be assigned to a single cluster. */
  maxPerCluster: number;
}

/**
 * Manages the GPU-side resources and compute passes for clustered forward lighting.
 *
 * @remarks
 * This class is the core of the light culling system. It creates and manages
 * the GPU buffers for the cluster grid and orchestrates the compute shaders
 * that assign lights to clusters each frame. It is designed to be owned and
 * operated by the `ClusterPass`.
 */
export class ClusterBuilder {
  private device: GPUDevice;
  private preprocessor = new ShaderPreprocessor();

  // Buffers shared with the main render pass via the frame bind group
  public clusterParamsBuffer!: GPUBuffer;
  public clusterCountsBuffer!: GPUBuffer;
  public clusterIndicesBuffer!: GPUBuffer;

  // Configuration and size tracking
  private cfg: ClusterConfig;
  private countsSize = 0;
  private indicesSize = 0;

  // Compute pipelines and layouts
  private clearPipeline!: GPUComputePipeline;
  private assignPipeline!: GPUComputePipeline;
  private computeBindGroupLayout!: GPUBindGroupLayout;

  // Internally managed bind group to avoid per-frame creation
  private computeBindGroup: GPUBindGroup | null = null;
  private lastLightsBuffer: GPUBuffer | null = null;

  // Resources for periodic statistics readback
  private readbackBuffer!: GPUBuffer;
  private readbackPending = false;
  private frameCounter = 0;
  private readonly READBACK_PERIOD = 8; // Read back stats every N frames
  private lastAvgLpcX1000 = 0;
  private lastMaxLpc = 0;
  private lastOverflowCount = 0;

  // Viewport dimensions
  private viewportW = 1;
  private viewportH = 1;

  /**
   * @param device - The active GPUDevice.
   * @param cfg - The configuration for the cluster grid.
   */
  constructor(device: GPUDevice, cfg: ClusterConfig) {
    this.device = device;
    this.cfg = cfg;
  }

  /**
   * Initializes the cluster builder.
   *
   * @remarks
   * This method creates the necessary GPU resources, including buffers and
   * compute pipelines, for the clustered forward rendering implementation. It
   * must be called before the cluster builder can be used.
   */
  public async init(): Promise<void> {
    this.clusterParamsBuffer = this.device.createBuffer({
      label: "CLUSTER_PARAMS_BUFFER",
      size: 192, // Sufficient for the ClusterParams struct
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.allocateClusterBuffers();

    this.readbackBuffer = this.device.createBuffer({
      label: "CLUSTER_COUNTS_READBACK",
      size: this.countsSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const code = await this.preprocessor.process(clusterUrl);
    const module = this.device.createShaderModule({
      label: "CLUSTER_COMPUTE_MODULE",
      code,
    });

    this.computeBindGroupLayout = this.device.createBindGroupLayout({
      label: "CLUSTER_COMPUTE_BGL",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: "CLUSTER_COMPUTE_PL",
      bindGroupLayouts: [this.computeBindGroupLayout],
    });

    this.clearPipeline = await this.device.createComputePipelineAsync({
      label: "CLUSTER_CLEAR_PIPELINE",
      layout: pipelineLayout,
      compute: { module, entryPoint: "cs_clear_counts" },
    });

    this.assignPipeline = await this.device.createComputePipelineAsync({
      label: "CLUSTER_ASSIGN_PIPELINE",
      layout: pipelineLayout,
      compute: { module, entryPoint: "cs_assign_lights" },
    });
  }

  private allocateClusterBuffers(): void {
    const numClusters = this.cfg.gridX * this.cfg.gridY * this.cfg.gridZ;
    this.countsSize = numClusters * 4;
    if (this.clusterCountsBuffer) this.clusterCountsBuffer.destroy();
    this.clusterCountsBuffer = this.device.createBuffer({
      label: "CLUSTER_COUNTS_BUFFER",
      size: this.countsSize,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
    this.indicesSize = numClusters * this.cfg.maxPerCluster * 4;
    if (this.clusterIndicesBuffer) this.clusterIndicesBuffer.destroy();
    this.clusterIndicesBuffer = this.device.createBuffer({
      label: "CLUSTER_INDICES_BUFFER",
      size: this.indicesSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Updates the cluster parameters uniform buffer.
   *
   * @remarks
   * This method packs camera and viewport data into a uniform buffer that is
   * used by the compute shaders to assign lights to clusters. It
   * should be called every frame before the `record` method.
   *
   * @param camera - The camera component.
   * @param viewportW - The width of the viewport.
   * @param viewportH - The height of the viewport.
   */
  public updateParams(
    camera: CameraComponent,
    viewportW: number,
    viewportH: number,
  ): void {
    this.setViewport(viewportW, viewportH);
    const m = camera.inverseViewMatrix;
    let rx = m[0],
      ry = m[1],
      rz = m[2];
    let ux = m[4],
      uy = m[5],
      uz = m[6];
    let fx = -m[8],
      fy = -m[9],
      fz = -m[10];
    const rl = Math.hypot(rx, ry, rz) || 1.0;
    const ul = Math.hypot(ux, uy, uz) || 1.0;
    const fl = Math.hypot(fx, fy, fz) || 1.0;
    rx /= rl;
    ry /= rl;
    rz /= rl;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    const near = camera.near;
    const far = camera.far;
    const invZRange = 1.0 / Math.max(far - near, 1e-6);
    const tanHalfFovY = Math.tan(camera.fovYRadians * 0.5);
    const aspect = camera.aspectRatio;
    const arr = new Float32Array(48);
    const u32 = new Uint32Array(arr.buffer);
    u32[0] = this.cfg.gridX;
    u32[1] = this.cfg.gridY;
    u32[2] = this.cfg.gridZ;
    u32[3] = this.cfg.maxPerCluster;
    arr[4] = this.viewportW;
    arr[5] = this.viewportH;
    arr[6] = 1.0 / this.viewportW;
    arr[7] = 1.0 / this.viewportH;
    arr[8] = near;
    arr[9] = far;
    arr[10] = invZRange;
    arr[11] = tanHalfFovY;
    arr[12] = aspect;
    arr[16] = rx;
    arr[17] = ry;
    arr[18] = rz;
    arr[20] = ux;
    arr[21] = uy;
    arr[22] = uz;
    arr[24] = fx;
    arr[25] = fy;
    arr[26] = fz;
    arr[28] = m[12];
    arr[29] = m[13];
    arr[30] = m[14];
    this.device.queue.writeBuffer(this.clusterParamsBuffer, 0, arr);
  }

  private createComputeBindGroup(lightsBuffer: GPUBuffer): void {
    this.computeBindGroup = this.device.createBindGroup({
      label: "CLUSTER_COMPUTE_BG",
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.clusterParamsBuffer } },
        { binding: 1, resource: { buffer: lightsBuffer } },
        { binding: 2, resource: { buffer: this.clusterCountsBuffer } },
        { binding: 3, resource: { buffer: this.clusterIndicesBuffer } },
      ],
    });
    this.lastLightsBuffer = lightsBuffer;
  }

  private async computeStatsFromReadback(): Promise<void> {
    if (this.readbackBuffer.mapState !== "unmapped") {
      console.warn(
        "[ClusterBuilder] Readback buffer is not in 'unmapped' state, skipping stats computation for this frame.",
      );
      return;
    }
    this.readbackPending = false; // Consume the pending flag now that we are attempting to map.

    try {
      await this.readbackBuffer.mapAsync(GPUMapMode.READ);
      const data = new Uint32Array(this.readbackBuffer.getMappedRange());
      const numClusters = this.cfg.gridX * this.cfg.gridY * this.cfg.gridZ;
      let sum = 0;
      let max = 0;
      let overflow = 0;
      const maxPer = this.cfg.maxPerCluster;
      for (let i = 0; i < numClusters; i++) {
        const c = data[i];
        sum += c;
        if (c > max) max = c;
        if (c > maxPer) overflow += c - maxPer;
      }

      const avg = numClusters > 0 ? sum / numClusters : 0;
      this.lastAvgLpcX1000 = Math.round(avg * 1000);
      this.lastMaxLpc = max;
      this.lastOverflowCount = overflow;
    } catch (err) {
      console.error("[ClusterBuilder] Failed to map readback buffer:", err);
    } finally {
      // Ensure unmap is always called if the buffer was successfully mapped.
      if (this.readbackBuffer.mapState !== "unmapped") {
        this.readbackBuffer.unmap();
      }
    }
  }

  public onSubmitted(): void {
    // Only attempt to process the readback if one is pending AND the buffer is free.
    if (this.readbackPending && this.readbackBuffer.mapState === "unmapped") {
      void this.computeStatsFromReadback();
    }
  }

  /**
   * Records the compute passes for clearing and assigning lights to clusters.
   * @remarks
   * This method now also manages the lifecycle of the compute bind group,
   * recreating it only when the underlying lights buffer has changed.
   * @param commandEncoder - The command encoder to record the passes into.
   * @param lightCount - The number of lights in the scene.
   * @param lightsBuffer - The GPU buffer containing the scene's light data.
   */
  public record(
    commandEncoder: GPUCommandEncoder,
    lightCount: number,
    lightsBuffer: GPUBuffer,
  ): void {
    if (lightsBuffer !== this.lastLightsBuffer) {
      this.createComputeBindGroup(lightsBuffer);
    }

    if (!this.computeBindGroup) return; // Guard if bind group hasn't been created

    const pass = commandEncoder.beginComputePass({
      label: "CLUSTER_CLEAR_PASS",
    });
    pass.setPipeline(this.clearPipeline);
    pass.setBindGroup(0, this.computeBindGroup);
    const total = this.cfg.gridX * this.cfg.gridY * this.cfg.gridZ;
    pass.dispatchWorkgroups(Math.ceil(total / 64));
    pass.end();

    if (lightCount > 0) {
      const assignPass = commandEncoder.beginComputePass({
        label: "CLUSTER_ASSIGN_PASS",
      });
      assignPass.setPipeline(this.assignPipeline);
      assignPass.setBindGroup(0, this.computeBindGroup);
      assignPass.dispatchWorkgroups(Math.ceil(lightCount / 64));
      assignPass.end();
    }

    this.frameCounter++;
    if (
      this.frameCounter % this.READBACK_PERIOD === 0 &&
      !this.readbackPending
    ) {
      commandEncoder.copyBufferToBuffer(
        this.clusterCountsBuffer,
        0,
        this.readbackBuffer,
        0,
        this.countsSize,
      );
      this.readbackPending = true;
    }
  }

  /**
   * Gets the cluster configuration.
   * @returns The cluster configuration.
   */
  public getConfig(): ClusterConfig {
    return this.cfg;
  }

  /**
   * Sets the viewport dimensions.
   * @param width - The width of the viewport.
   * @param height - The height of the viewport.
   */
  public setViewport(width: number, height: number): void {
    this.viewportW = Math.max(1, Math.floor(width));
    this.viewportH = Math.max(1, Math.floor(height));
  }

  /**
   * Gets the latest statistics from the cluster builder.
   * @remarks
   * The statistics are read back from the GPU periodically, so they may not
   * be updated every frame.
   * @returns The latest cluster statistics.
   */
  public getLastStats(): {
    avgLpcX1000: number;
    maxLpc: number;
    overflow: number;
  } {
    return {
      avgLpcX1000: this.lastAvgLpcX1000,
      maxLpc: this.lastMaxLpc,
      overflow: this.lastOverflowCount,
    };
  }
}

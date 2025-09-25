// src/core/rendering/clusterBuilder.ts
import clusterUrl from "@/core/shaders/cluster.wgsl?url";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";

export interface ClusterConfig {
  gridX: number;
  gridY: number;
  gridZ: number;
  maxPerCluster: number;
}

export class ClusterBuilder {
  private device: GPUDevice;
  private preprocessor = new ShaderPreprocessor();

  // Buffers shared with render pass
  public clusterParamsBuffer!: GPUBuffer;
  public clusterCountsBuffer!: GPUBuffer;
  public clusterIndicesBuffer!: GPUBuffer;

  // Sizes
  private cfg: ClusterConfig;
  private countsSize = 0;
  private indicesSize = 0;

  // Compute pipelines and bind group layout
  private clearPipeline!: GPUComputePipeline;
  private assignPipeline!: GPUComputePipeline;
  private computeBindGroupLayout!: GPUBindGroupLayout;
  private clearBindGroup!: GPUBindGroup;
  private assignBindGroup!: GPUBindGroup;

  private readbackBuffer!: GPUBuffer;
  private readbackPending = false;
  private frameCounter = 0;
  private readonly READBACK_PERIOD = 8; // every N frames
  private lastAvgLpcX1000 = 0; // average lights per cluster * 1000 (int)
  private lastMaxLpc = 0; // max lights in any cluster
  private lastOverflowCount = 0; // sum of (count - maxPerCluster) over clusters

  private viewportW = 1;
  private viewportH = 1;

  constructor(device: GPUDevice, cfg: ClusterConfig) {
    this.device = device;
    this.cfg = cfg;
  }

  /**
   * Initializes the cluster builder.
   *
   * This method creates the necessary GPU resources, including buffers and
   * compute pipelines, for the clustered forward rendering implementation. It
   * must be called before the cluster builder can be used.
   */
  public async init(): Promise<void> {
    this.clusterParamsBuffer = this.device.createBuffer({
      label: "CLUSTER_PARAMS_BUFFER",
      size: 16 * 16, // 256 bytes to cover the struct comfortably
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.allocateClusterBuffers();

    // Create readback buffer for counts (MAP_READ | COPY_DST)
    this.readbackBuffer = this.device.createBuffer({
      label: "CLUSTER_COUNTS_READBACK",
      size: this.countsSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // Load/compile compute shader
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
        }, // params
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        }, // lights
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        }, // counts (RW)
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        }, // indices (RW)
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: "CLUSTER_COMPUTE_PL",
      bindGroupLayouts: [this.computeBindGroupLayout],
    });

    this.clearPipeline = this.device.createComputePipeline({
      label: "CLUSTER_CLEAR_PIPELINE",
      layout: pipelineLayout,
      compute: {
        module,
        entryPoint: "cs_clear_counts",
      },
    });

    this.assignPipeline = this.device.createComputePipeline({
      label: "CLUSTER_ASSIGN_PIPELINE",
      layout: pipelineLayout,
      compute: {
        module,
        entryPoint: "cs_assign_lights",
      },
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
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
  }

  /**
   * Updates the cluster parameters uniform buffer.
   *
   * This method packs camera and viewport data into a uniform buffer that is
   * used by the compute shaders to correctly assign lights to clusters. It
   * should be called every frame before the `record` method.
   *
   * @param camera The camera component.
   * @param viewportW The width of the viewport.
   * @param viewportH The height of the viewport.
   */
  public updateParams(
    camera: CameraComponent,
    viewportW: number,
    viewportH: number,
  ): void {
    this.setViewport(viewportW, viewportH);

    // Camera basis from inverseViewMatrix (world transform of camera)
    const m = camera.inverseViewMatrix;

    // Right = col0, Up = col1, Forward = -col2 (normalize)
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

    // Pack ClusterParams as 16 vec4-aligned floats (we use a generous buffer size)
    const arr = new Float32Array(48); // 192B used
    const u32 = new Uint32Array(arr.buffer);

    // u32 gridX, gridY, gridZ, maxPerCluster
    u32[0] = this.cfg.gridX >>> 0;
    u32[1] = this.cfg.gridY >>> 0;
    u32[2] = this.cfg.gridZ >>> 0;
    u32[3] = this.cfg.maxPerCluster >>> 0;

    // viewportSize, invViewportSize
    arr[4] = this.viewportW;
    arr[5] = this.viewportH;
    arr[6] = 1.0 / this.viewportW;
    arr[7] = 1.0 / this.viewportH;

    // near, far, invZRange, tanHalfFovY
    arr[8] = near;
    arr[9] = far;
    arr[10] = invZRange;
    arr[11] = tanHalfFovY;

    // aspect, padding
    arr[12] = aspect;
    arr[13] = 0.0;
    arr[14] = 0.0;
    arr[15] = 0.0;

    // cameraRight.xyz
    arr[16] = rx;
    arr[17] = ry;
    arr[18] = rz;
    arr[19] = 0.0;
    // cameraUp.xyz
    arr[20] = ux;
    arr[21] = uy;
    arr[22] = uz;
    arr[23] = 0.0;
    // cameraForward.xyz
    arr[24] = fx;
    arr[25] = fy;
    arr[26] = fz;
    arr[27] = 0.0;
    // cameraPos.xyz
    arr[28] = m[12];
    arr[29] = m[13];
    arr[30] = m[14];
    arr[31] = 1.0;

    // Uploading the packed data to the GPU buffer
    this.device.queue.writeBuffer(this.clusterParamsBuffer, 0, arr);
  }

  /**
   * Creates the bind group for the compute shaders.
   *
   * This method creates a bind group that contains all the resources needed
   * by the compute shaders, including the cluster parameters, the light list,
   * and the cluster counts and indices buffers.
   *
   * @param lightsBuffer The buffer containing the light data.
   */
  public createComputeBindGroup(lightsBuffer: GPUBuffer): void {
    this.clearBindGroup = this.device.createBindGroup({
      label: "CLUSTER_CLEAR_BG",
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.clusterParamsBuffer } },
        { binding: 1, resource: { buffer: lightsBuffer } },
        { binding: 2, resource: { buffer: this.clusterCountsBuffer } },
        { binding: 3, resource: { buffer: this.clusterIndicesBuffer } },
      ],
    });

    this.assignBindGroup = this.clearBindGroup; // same bindings
  }

  private async computeStatsFromReadback(): Promise<void> {
    try {
      await this.readbackBuffer.mapAsync(GPUMapMode.READ);
      const data = new Uint32Array(this.readbackBuffer.getMappedRange());
      const numClusters = this.cfg.gridX * this.cfg.gridY * this.cfg.gridZ;
      let sum = 0;
      let max = 0;
      let overflow = 0;
      const maxPer = this.cfg.maxPerCluster >>> 0;
      for (let i = 0; i < numClusters; i++) {
        const c = data[i] >>> 0;
        sum += c;
        if (c > max) max = c;
        if (c > maxPer) overflow += c - maxPer;
      }
      this.readbackBuffer.unmap();
      // Store as ints for metrics
      const avg = numClusters > 0 ? sum / numClusters : 0;
      this.lastAvgLpcX1000 = Math.min(0x7fffffff, Math.round(avg * 1000));
      this.lastMaxLpc = max;
      this.lastOverflowCount = overflow;
    } catch {
      // Mapping may fail if GPU timeline not ready; ignore this cycle
    } finally {
      this.readbackPending = false;
    }
  }

  /**
   * Notifies the cluster builder that a command buffer has been submitted.
   *
   * This method is called by the renderer after it has submitted a command
   * buffer that includes a copy operation to the readback buffer. This
   * allows the cluster builder to start the asynchronous process of mapping
   * the readback buffer and computing statistics.
   */
  public onSubmitted(): void {
    // Kick off async map+read once a copy has been enqueued in the same frame
    if (this.readbackPending) {
      // Schedule compute; do not await
      void this.computeStatsFromReadback();
    }
  }

  /**
   * Records the compute passes for clearing and assigning lights to clusters.
   *
   * This method records two compute passes: one to clear the cluster counts
   * from the previous frame, and another to assign the current frame's
   * lights to their corresponding clusters. It also periodically records a
   * copy operation to a readback buffer for statistics.
   *
   * @param commandEncoder The command encoder to record the passes into.
   * @param lightCount The number of lights in the scene.
   */
  public record(commandEncoder: GPUCommandEncoder, lightCount: number): void {
    // Clear counts
    {
      const pass = commandEncoder.beginComputePass({
        label: "CLUSTER_CLEAR_PASS",
      });
      pass.setPipeline(this.clearPipeline);
      pass.setBindGroup(0, this.clearBindGroup);
      const total = this.cfg.gridX * this.cfg.gridY * this.cfg.gridZ;
      const wg = Math.ceil(total / 64);
      pass.dispatchWorkgroups(wg);
      pass.end();
    }
    // Assign lights
    if (lightCount > 0) {
      const pass = commandEncoder.beginComputePass({
        label: "CLUSTER_ASSIGN_PASS",
      });
      pass.setPipeline(this.assignPipeline);
      pass.setBindGroup(0, this.assignBindGroup);
      const wg = Math.ceil(lightCount / 64);
      pass.dispatchWorkgroups(wg);
      pass.end();
    }

    // Periodic readback copy of counts to staging buffer
    this.frameCounter++;
    if (this.frameCounter % this.READBACK_PERIOD === 0) {
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
   * @param width The width of the viewport.
   * @param height The height of the viewport.
   */
  public setViewport(width: number, height: number): void {
    this.viewportW = Math.max(1, Math.floor(width));
    this.viewportH = Math.max(1, Math.floor(height));
  }

  /**
   * Gets the latest statistics from the cluster builder.
   *
   * The statistics are read back from the GPU periodically, so they may not
   * be updated every frame.
   *
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

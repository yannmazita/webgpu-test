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

  private viewportW = 1;
  private viewportH = 1;

  constructor(device: GPUDevice, cfg: ClusterConfig) {
    this.device = device;
    this.cfg = cfg;
  }

  public async init(): Promise<void> {
    this.clusterParamsBuffer = this.device.createBuffer({
      label: "CLUSTER_PARAMS_BUFFER",
      size: 16 * 16, // 256 bytes to cover the struct comfortably
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.allocateClusterBuffers();

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

    this.device.queue.writeBuffer(this.clusterParamsBuffer, 0, arr);
  }

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
  }

  public getConfig(): ClusterConfig {
    return this.cfg;
  }

  public setViewport(width: number, height: number): void {
    this.viewportW = Math.max(1, Math.floor(width));
    this.viewportH = Math.max(1, Math.floor(height));
  }
}

// src/core/rendering/clusterBuilder.ts
import clusterUrl from "@/core/shaders/cluster.wgsl?url";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";

export interface ClusterConfig {
  gridZ: number; // number of Z-slices
  maxPerCluster: number; // fixed cap per slice
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

  constructor(device: GPUDevice, cfg: ClusterConfig) {
    this.device = device;
    this.cfg = cfg;
  }

  public async init(): Promise<void> {
    // Params UBO: 2x vec4 + 2x vec4 + 2x vec4 = 48 bytes
    this.clusterParamsBuffer = this.device.createBuffer({
      label: "CLUSTER_PARAMS_BUFFER",
      size: 64, // pad to 64B for alignment
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
    // counts: gridZ u32 atomics (we bind as storage)
    this.countsSize = this.cfg.gridZ * 4;
    if (this.clusterCountsBuffer) this.clusterCountsBuffer.destroy();
    this.clusterCountsBuffer = this.device.createBuffer({
      label: "CLUSTER_COUNTS_BUFFER",
      size: this.countsSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // indices: gridZ * maxPerCluster u32s
    this.indicesSize = this.cfg.gridZ * this.cfg.maxPerCluster * 4;
    if (this.clusterIndicesBuffer) this.clusterIndicesBuffer.destroy();
    this.clusterIndicesBuffer = this.device.createBuffer({
      label: "CLUSTER_INDICES_BUFFER",
      size: this.indicesSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  public updateParams(camera: CameraComponent): void {
    // Compute camera forward in world space: -column2 of inverseViewMatrix, normalized
    const m = camera.inverseViewMatrix;
    let fx = -m[8],
      fy = -m[9],
      fz = -m[10];
    const len = Math.hypot(fx, fy, fz) || 1.0;
    fx /= len;
    fy /= len;
    fz /= len;

    const near = camera.near;
    const far = camera.far;
    const invZRange = 1.0 / Math.max(far - near, 1e-6);

    // Pack ClusterParams
    // layout:
    // u32 gridZ, u32 maxPerCluster, u32 pad0, u32 pad1,
    // f32 near, f32 far, f32 invZRange, f32 pad2,
    // vec4 cameraForward, vec4 cameraPos
    const arr = new Float32Array(16);
    const u32 = new Uint32Array(arr.buffer);

    u32[0] = this.cfg.gridZ >>> 0;
    u32[1] = this.cfg.maxPerCluster >>> 0;
    u32[2] = 0;
    u32[3] = 0;

    arr[4] = near;
    arr[5] = far;
    arr[6] = invZRange;
    arr[7] = 0.0;

    arr[8] = fx;
    arr[9] = fy;
    arr[10] = fz;
    arr[11] = 0.0;

    arr[12] = m[12];
    arr[13] = m[13];
    arr[14] = m[14];
    arr[15] = 1.0;

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
      const wg = Math.ceil(this.cfg.gridZ / 64);
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
}

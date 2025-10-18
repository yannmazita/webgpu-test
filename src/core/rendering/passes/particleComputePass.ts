// src/core/rendering/passes/particleComputePass.ts
import { Shader } from "@/core/shaders/shader";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import particleComputeShaderUrl from "@/core/shaders/particle_compute.wgsl?url";

/**
 * A compute pass for simulating particles on the GPU.
 * @remarks
 * This pass updates particle positions, velocities, and ages using a compute shader.
 * It uses double buffering to avoid read-write conflicts, swapping between input
 * and output buffers each frame.
 */
export class ParticleComputePass {
  private device: GPUDevice;
  private pipeline!: GPUComputePipeline;
  private bindGroupLayout!: GPUBindGroupLayout;
  private simParamsBuffer!: GPUBuffer;

  // Double buffering for particle data
  private particleBuffers!: [GPUBuffer, GPUBuffer];
  private currentReadIndex = 0;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /**
   * Initializes the compute pipeline and resources.
   * @param particleCount The maximum number of particles to simulate.
   */
  public async init(particleCount: number): Promise<void> {
    const preprocessor = new ShaderPreprocessor();
    const shader = await Shader.fromUrl(
      this.device,
      preprocessor,
      particleComputeShaderUrl,
      "PARTICLE_COMPUTE_SHADER",
      "cs_main",
    );

    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: "PARTICLE_COMPUTE_BGL",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        }, // sim params
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        }, // particles in
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        }, // particles out
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: "PARTICLE_COMPUTE_PIPELINE_LAYOUT",
      bindGroupLayouts: [this.bindGroupLayout],
    });

    this.pipeline = await this.device.createComputePipelineAsync({
      label: "PARTICLE_COMPUTE_PIPELINE",
      layout: pipelineLayout,
      compute: {
        module: shader.module,
        entryPoint: "cs_main",
      },
    });

    // Create simulation parameters buffer
    this.simParamsBuffer = this.device.createBuffer({
      label: "PARTICLE_SIM_PARAMS_BUFFER",
      size: 16, // 4 floats: delta_time, gravity, particle_count, padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create double-buffered particle storage
    const particleStructSize = 32; // 8 floats * 4 bytes
    const bufferSize = particleCount * particleStructSize;

    this.particleBuffers = [
      this.device.createBuffer({
        label: "PARTICLE_BUFFER_0",
        size: bufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
      this.device.createBuffer({
        label: "PARTICLE_BUFFER_1",
        size: bufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    ];
  }

  /**
   * Executes the particle simulation.
   * @param commandEncoder The command encoder to record commands into.
   * @param deltaTime The time elapsed since the last frame.
   * @param gravity The gravity force to apply to particles.
   * @param particleCount The number of active particles.
   * @returns The buffer containing the updated particle data.
   */
  public execute(
    commandEncoder: GPUCommandEncoder,
    deltaTime: number,
    gravity: number,
    particleCount: number,
  ): GPUBuffer {
    if (particleCount === 0) {
      return this.particleBuffers[this.currentReadIndex];
    }

    // Update simulation parameters
    const simParams = new Float32Array([
      deltaTime,
      gravity,
      particleCount,
      0, // padding
    ]);
    this.device.queue.writeBuffer(this.simParamsBuffer, 0, simParams);

    // Create bind group for this frame
    const readBuffer = this.particleBuffers[this.currentReadIndex];
    const writeBuffer = this.particleBuffers[1 - this.currentReadIndex];

    const bindGroup = this.device.createBindGroup({
      label: "PARTICLE_COMPUTE_BIND_GROUP",
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.simParamsBuffer } },
        { binding: 1, resource: { buffer: readBuffer } },
        { binding: 2, resource: { buffer: writeBuffer } },
      ],
    });

    // Record compute pass
    const passEncoder = commandEncoder.beginComputePass({
      label: "PARTICLE_COMPUTE_PASS",
    });
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, bindGroup);

    // Dispatch workgroups (64 threads per workgroup)
    const workgroupCount = Math.ceil(particleCount / 64);
    passEncoder.dispatchWorkgroups(workgroupCount);
    passEncoder.end();

    // Swap buffers for next frame
    this.currentReadIndex = 1 - this.currentReadIndex;

    // Return the buffer that was just written to (now the read buffer for next frame)
    return writeBuffer;
  }

  /**
   * Gets the current particle buffer for rendering.
   * @returns The buffer containing particle data.
   */
  public getParticleBuffer(): GPUBuffer {
    return this.particleBuffers[this.currentReadIndex];
  }

  /**
   * Gets a particle buffer for writing initial particle data.
   * @returns A writable particle buffer.
   */
  public getWriteableBuffer(): GPUBuffer {
    return this.particleBuffers[1 - this.currentReadIndex];
  }

  /**
   * Destroys all GPU resources.
   */
  public destroy(): void {
    this.simParamsBuffer.destroy();
    this.particleBuffers[0].destroy();
    this.particleBuffers[1].destroy();
  }
}

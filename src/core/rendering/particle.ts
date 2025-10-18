// src/core/rendering/particle.ts
import { ParticleEmitterComponent } from "@/core/ecs/components/particleComponents";
import { PRNG } from "@/core/utils/prng";
import { vec3, Vec3 } from "wgpu-matrix";
import particleComputeShaderUrl from "@/core/shaders/particle_compute.wgsl?url";
import { Shader } from "@/core/shaders/shader";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";

// Must match the struct in particle_compute.wgsl
const PARTICLE_STRIDE_IN_FLOATS = 3 + 1 + 3 + 1 + 1 + 1 + 4 + 4; // 18 floats
const PARTICLE_STRIDE_BYTES = PARTICLE_STRIDE_IN_FLOATS * 4;

/**
 * Manages the GPU resources and simulation logic for the particle system.
 * @remarks
 * This class is part of the rendering engine and owns the GPU buffers, pipelines,
 * and bind groups necessary for particle simulation and rendering. It is controlled
 * by the high-level `ParticleSystem` (the ECS system) and the `Renderer`.
 */
export class ParticleSubsystem {
  private device: GPUDevice;
  private prng = new PRNG();

  // GPU Resources
  private particleBuffers: [GPUBuffer, GPUBuffer];
  private simParamsBuffer: GPUBuffer;
  private computePipeline!: GPUComputePipeline;
  private computeBindGroupLayout!: GPUBindGroupLayout;
  private computeBindGroups!: [GPUBindGroup, GPUBindGroup];
  private particleData: Float32Array;

  // State
  private maxParticles: number;
  private currentBufferIndex = 0;
  private lastSpawnIndex = 0;
  private activeParticleCount = 0;

  public static readonly GRAVITY = -9.81;

  /**
   * @param device The WebGPU device.
   * @param maxParticles The maximum number of particles to simulate.
   */
  constructor(device: GPUDevice, maxParticles = 100000) {
    this.device = device;
    this.maxParticles = maxParticles;

    const bufferSize = this.maxParticles * PARTICLE_STRIDE_BYTES;

    this.particleBuffers = [
      device.createBuffer({
        label: "PARTICLE_BUFFER_A",
        size: bufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
      device.createBuffer({
        label: "PARTICLE_BUFFER_B",
        size: bufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    ];

    this.simParamsBuffer = device.createBuffer({
      label: "PARTICLE_SIM_PARAMS_BUFFER",
      size: 16, // delta_time, gravity, particle_count, padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // CPU-side buffer for spawning new particles
    this.particleData = new Float32Array(
      this.maxParticles * PARTICLE_STRIDE_IN_FLOATS,
    );
    // Initialize all particles as "dead"
    for (let i = 0; i < this.maxParticles; i++) {
      const offset = i * PARTICLE_STRIDE_IN_FLOATS;
      this.particleData[offset + 3] = 0.0; // lifetime
      this.particleData[offset + 7] = 1.0; // age
    }
    this.device.queue.writeBuffer(
      this.particleBuffers[0],
      0,
      this.particleData,
    );
    this.device.queue.writeBuffer(
      this.particleBuffers[1],
      0,
      this.particleData,
    );
  }

  /**
   * Initializes the compute pipeline for particle simulation.
   */
  public async init(): Promise<void> {
    const preprocessor = new ShaderPreprocessor();
    const shader = await Shader.fromUrl(
      this.device,
      preprocessor,
      particleComputeShaderUrl, // Use compute-only shader
      "PARTICLE_COMPUTE_SHADER",
      "cs_main", // Only need compute entry point
    );

    this.computeBindGroupLayout = this.device.createBindGroupLayout({
      label: "PARTICLE_COMPUTE_BGL",
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
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.computeBindGroupLayout],
    });

    this.computePipeline = await this.device.createComputePipelineAsync({
      label: "PARTICLE_COMPUTE_PIPELINE",
      layout: pipelineLayout,
      compute: {
        module: shader.module,
        entryPoint: "cs_main",
      },
    });

    this.computeBindGroups = [
      this.createComputeBindGroup(0, 1), // Read A, Write B
      this.createComputeBindGroup(1, 0), // Read B, Write A
    ];
  }

  private createComputeBindGroup(
    readIndex: number,
    writeIndex: number,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.simParamsBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffers[readIndex] } },
        { binding: 2, resource: { buffer: this.particleBuffers[writeIndex] } },
      ],
    });
  }

  /**
   * Spawns a batch of new particles by writing their initial state to the GPU buffer.
   * @param count The number of particles to spawn.
   * @param emitter The emitter component defining particle properties.
   * @param origin The world-space position to spawn particles at.
   */
  public spawn(
    count: number,
    emitter: ParticleEmitterComponent,
    origin: Vec3,
  ): void {
    const particlesToUpdate: { index: number; data: Float32Array }[] = [];
    let spawned = 0;

    for (let i = 0; i < count && spawned < count; i++) {
      for (let j = 0; j < this.maxParticles; j++) {
        const particleIndex = (this.lastSpawnIndex + j) % this.maxParticles;
        const offset = particleIndex * PARTICLE_STRIDE_IN_FLOATS;

        const age = this.particleData[offset + 7];
        const lifetime = this.particleData[offset + 3];

        if (age >= lifetime || lifetime <= 0.0) {
          this.particleData.set(origin, offset);
          const newLifetime = this.prng.range(
            emitter.particleLifetime.min,
            emitter.particleLifetime.max,
          );
          this.particleData[offset + 3] = newLifetime;
          const vx =
            emitter.initialVelocity[0] +
            this.prng.range(-emitter.spread[0], emitter.spread[0]);
          const vy =
            emitter.initialVelocity[1] +
            this.prng.range(-emitter.spread[1], emitter.spread[1]);
          const vz =
            emitter.initialVelocity[2] +
            this.prng.range(-emitter.spread[2], emitter.spread[2]);
          this.particleData.set([vx, vy, vz], offset + 4);
          this.particleData[offset + 7] = 0.0;
          this.particleData[offset + 8] = emitter.startSize;
          this.particleData[offset + 9] = emitter.endSize;
          this.particleData.set(emitter.startColor, offset + 10);
          this.particleData.set(emitter.endColor, offset + 14);

          const particleSubArray = this.particleData.subarray(
            offset,
            offset + PARTICLE_STRIDE_IN_FLOATS,
          );
          particlesToUpdate.push({
            index: particleIndex,
            data: particleSubArray,
          });

          this.lastSpawnIndex = (particleIndex + 1) % this.maxParticles;
          spawned++;
          break;
        }
      }
    }

    // Update the active particle count
    this.activeParticleCount = Math.min(
      this.activeParticleCount + spawned,
      this.maxParticles,
    );

    // Write spawned particles to the current read buffer
    const readBuffer = this.particleBuffers[this.currentBufferIndex];
    for (const p of particlesToUpdate) {
      this.device.queue.writeBuffer(
        readBuffer,
        p.index * PARTICLE_STRIDE_BYTES,
        p.data,
      );
    }
  }

  /**
   * Records the compute pass for the particle simulation.
   * @param commandEncoder The command encoder for the current frame.
   * @param deltaTime The time elapsed since the last frame.
   */
  public updateSimulation(
    commandEncoder: GPUCommandEncoder,
    deltaTime: number,
  ): void {
    // Update simulation parameters with actual active particle count
    this.device.queue.writeBuffer(
      this.simParamsBuffer,
      0,
      new Float32Array([
        deltaTime,
        ParticleSubsystem.GRAVITY,
        this.activeParticleCount,
        0, // padding
      ]),
    );

    const passEncoder = commandEncoder.beginComputePass({
      label: "PARTICLE_SIM_PASS",
    });
    passEncoder.setPipeline(this.computePipeline);
    passEncoder.setBindGroup(
      0,
      this.computeBindGroups[this.currentBufferIndex],
    );
    passEncoder.dispatchWorkgroups(Math.ceil(this.activeParticleCount / 64));
    passEncoder.end();

    // Ping-pong the buffers for the next frame
    this.currentBufferIndex = 1 - this.currentBufferIndex;
  }

  /**
   * Gets the GPU resources needed for rendering.
   * @returns An object containing the particle buffer and total particle count.
   */
  public getRenderResources(): { buffer: GPUBuffer; count: number } {
    return {
      buffer: this.particleBuffers[this.currentBufferIndex],
      count: this.activeParticleCount,
    };
  }

  /**
   * Gets the number of currently active particles.
   * @returns The active particle count.
   */
  public getActiveParticleCount(): number {
    return this.activeParticleCount;
  }

  /**
   * Resets the particle system, clearing all particles.
   */
  public reset(): void {
    this.activeParticleCount = 0;
    this.lastSpawnIndex = 0;
    this.currentBufferIndex = 0;

    // Reset all particles to dead state
    for (let i = 0; i < this.maxParticles; i++) {
      const offset = i * PARTICLE_STRIDE_IN_FLOATS;
      this.particleData[offset + 3] = 0.0; // lifetime
      this.particleData[offset + 7] = 1.0; // age
    }

    this.device.queue.writeBuffer(
      this.particleBuffers[0],
      0,
      this.particleData,
    );
    this.device.queue.writeBuffer(
      this.particleBuffers[1],
      0,
      this.particleData,
    );
  }

  /**
   * Destroys all GPU resources.
   */
  public destroy(): void {
    this.particleBuffers[0].destroy();
    this.particleBuffers[1].destroy();
    this.simParamsBuffer.destroy();
  }
}

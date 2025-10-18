// src/core/rendering/passes/particlePass.ts
import { RenderContext, RenderPass } from "@/core/types/rendering";
import { Shader } from "@/core/shaders/shader";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import particleShaderUrl from "@/core/shaders/particle.wgsl?url";

/**
 * A render pass for drawing GPU-simulated particles.
 * @remarks
 * This pass renders all active particles as camera-facing billboards. It uses
 * a single, massive instanced draw call to render all particles efficiently.
 * The vertex shader reads particle data directly from a storage buffer and
 * constructs the billboard geometry on the fly, while the fragment shader
 * handles color interpolation and texture mapping.
 *
 * This pass should be executed after the opaque pass and blended with the scene.
 */
export class ParticlePass implements RenderPass {
  private device: GPUDevice;
  private pipeline!: GPURenderPipeline;
  private renderBindGroupLayout!: GPUBindGroupLayout;

  // Fallback texture for particles
  private dummyTexture!: GPUTexture;
  private dummySampler!: GPUSampler;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  public async init(
    frameBindGroupLayout: GPUBindGroupLayout,
    canvasFormat: GPUTextureFormat,
    depthFormat: GPUTextureFormat,
  ): Promise<void> {
    const preprocessor = new ShaderPreprocessor();
    const shader = await Shader.fromUrl(
      this.device,
      preprocessor,
      particleShaderUrl,
      "PARTICLE_SHADER",
      "vs_main",
      "fs_main",
    );

    this.renderBindGroupLayout = this.device.createBindGroupLayout({
      label: "PARTICLE_RENDER_BGL",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        }, // particle buffer
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {},
        }, // particle texture
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {},
        }, // particle sampler
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: "PARTICLE_RENDER_PIPELINE_LAYOUT",
      bindGroupLayouts: [frameBindGroupLayout, this.renderBindGroupLayout],
    });

    this.pipeline = await this.device.createRenderPipelineAsync({
      label: "PARTICLE_RENDER_PIPELINE",
      layout: pipelineLayout,
      vertex: {
        module: shader.module,
        entryPoint: "vs_main",
      },
      fragment: {
        module: shader.module,
        entryPoint: "fs_main",
        targets: [
          {
            format: canvasFormat,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: {
        topology: "triangle-strip",
        stripIndexFormat: "uint32",
      },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: "less",
        format: depthFormat,
      },
    });

    // Create a dummy 1x1 white texture
    this.dummyTexture = this.device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.dummyTexture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );
    this.dummySampler = this.device.createSampler();
  }

  public execute(
    context: RenderContext,
    passEncoder: GPURenderPassEncoder,
  ): void {
    const { particleBuffer, particleCount } = context;

    if (
      !this.pipeline ||
      !particleBuffer ||
      !particleCount ||
      particleCount === 0
    ) {
      return;
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: particleBuffer } },
        { binding: 1, resource: this.dummyTexture.createView() },
        { binding: 2, resource: this.dummySampler },
      ],
    });

    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, context.frameBindGroup);
    passEncoder.setBindGroup(1, bindGroup);
    passEncoder.draw(4, particleCount, 0, 0);
  }
}

// src/core/renderer.ts
import shaderCode from "@/core/shaders/shaders.wgsl";
import { createShaderModule } from "@/core/utils/webgpu";
import { Renderable } from "./types/gpu";
import { getLayoutKey } from "./utils/layout";
import { createTextureFromImage } from "./utils/texture";

export class Renderer {
  public device!: GPUDevice;

  // Internal state management
  private canvas: HTMLCanvasElement;
  private context!: GPUCanvasContext;
  private adapter!: GPUAdapter;
  private pipelines = new Map<string, GPURenderPipeline>();
  private shaderModule!: GPUShaderModule;
  private uniformBuffer!: GPUBuffer;
  private uniformBindGroup!: GPUBindGroup;
  private pipelineLayout!: GPUPipelineLayout;
  private bindGroupLayout!: GPUBindGroupLayout;
  private uniformBufferAlignment!: number;
  private sampler!: GPUSampler;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /**
   * Initializes the WebGPU device, context, shaders, and buffers.
   * This must be called before loading textures or rendering.
   */
  public async init(): Promise<void> {
    await this.setupDevice();
    this.setupContext();
    this.shaderModule = createShaderModule(this.device, shaderCode);

    // This sampler is static and doesn't depend on the texture.
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });

    this.uniformBufferAlignment =
      this.device.limits.minUniformBufferOffsetAlignment;

    const MATRIX_SIZE = 4 * 4 * Float32Array.BYTES_PER_ELEMENT;
    const ALIGNED_MATRIX_SIZE = Math.max(
      MATRIX_SIZE,
      this.uniformBufferAlignment,
    );

    const MAX_OBJECTS = 100;
    this.uniformBuffer = this.device.createBuffer({
      size: MAX_OBJECTS * ALIGNED_MATRIX_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0, // Uniform Buffer
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform", hasDynamicOffset: true },
        },
        {
          binding: 1, // Texture View
          visibility: GPUShaderStage.FRAGMENT,
          texture: {},
        },
        {
          binding: 2, // Sampler
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {},
        },
      ],
    });

    this.pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });
  }

  /**
   * Loads a texture and creates the primary bind group for rendering.
   * @param imageUrl The URL of the texture to load.
   */
  public async createTextureBindGroup(imageUrl: string): Promise<void> {
    const texture = await createTextureFromImage(this.device, imageUrl);

    this.uniformBindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.uniformBuffer,
            size: Math.max(
              4 * 4 * Float32Array.BYTES_PER_ELEMENT,
              this.uniformBufferAlignment,
            ),
          },
        },
        {
          binding: 1,
          resource: texture.createView(),
        },
        {
          binding: 2,
          resource: this.sampler,
        },
      ],
    });
  }

  /**
   * Checks for WebGPU support and acquires the GPU device and adapter.
   */
  private async setupDevice(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error("WebGPU is not supported by this browser.");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("Failed to get GPU adapter.");
    }
    this.adapter = adapter;

    this.device = await this.adapter.requestDevice();
  }

  /**
   * Configures the canvas context for rendering.
   */
  private setupContext(): void {
    this.context = this.canvas.getContext("webgpu") as GPUCanvasContext;
    const canvasConfig: GPUCanvasConfiguration = {
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: "opaque",
    };
    this.context.configure(canvasConfig);
  }

  /**
   * Retrieves a cached pipeline for the given layout or creates a new one.
   * @param layout - The vertex buffer layout for the mesh.
   * @returns A GPURenderPipeline configured for the given layout.
   */
  private getOrCreatePipeline(
    layout: GPUVertexBufferLayout,
  ): GPURenderPipeline {
    const layoutKey = getLayoutKey(layout);
    // Check if a pipeline for this specific layout already exists.
    if (this.pipelines.has(layoutKey)) {
      return this.pipelines.get(layoutKey)!;
    }

    // If not, create a new pipeline.
    const newPipeline = this.device.createRenderPipeline({
      layout: this.pipelineLayout, // Use the shared pipeline layout
      vertex: {
        module: this.shaderModule,
        entryPoint: "vs_main",
        buffers: [layout], // Use the provided layout
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: "fs_main",
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
      },
      primitive: {
        topology: "triangle-list",
        frontFace: "ccw",
        cullMode: "back",
      },
    });

    // Cache the new pipeline for future use.
    this.pipelines.set(layoutKey, newPipeline);
    return newPipeline;
  }

  /**
   * Renders a scene composed of multiple Renderable objects.
   * @param scene - An array of Renderable objects to be rendered.
   */
  public render(scene: Renderable[]): void {
    if (!this.uniformBindGroup) {
      console.error(
        "Render called before createTextureBindGroup. No bind group available.",
      );
      return;
    }
    const textureView = this.context.getCurrentTexture().createView();
    const commandEncoder = this.device.createCommandEncoder();

    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.1, g: 0.1, b: 0.15, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    passEncoder.setViewport(0, 0, this.canvas.width, this.canvas.height, 0, 1);

    let lastPipeline: GPURenderPipeline | undefined;

    const ALIGNED_MATRIX_SIZE = Math.max(
      4 * 4 * Float32Array.BYTES_PER_ELEMENT,
      this.uniformBufferAlignment,
    );

    // Iterate over the renderable objects and draw them.
    scene.forEach((renderable, i) => {
      const { mesh, modelMatrix } = renderable;
      const pipeline = this.getOrCreatePipeline(mesh.layout);

      if (pipeline !== lastPipeline) {
        passEncoder.setPipeline(pipeline);
        lastPipeline = pipeline;
      }

      // Calculate the offset for the current object's matrix.
      const bufferOffset = i * ALIGNED_MATRIX_SIZE;

      // Write the matrix data to the uniform buffer at the calculated offset.
      this.device.queue.writeBuffer(
        this.uniformBuffer,
        bufferOffset,
        modelMatrix as Float32Array,
      );

      // Set the bind group with the dynamic offset for this specific draw call.
      passEncoder.setBindGroup(0, this.uniformBindGroup, [bufferOffset]);
      passEncoder.setVertexBuffer(0, mesh.buffer);
      passEncoder.draw(mesh.vertexCount, 1, 0, 0);
    });

    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }
}

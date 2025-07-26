// src/core/Renderer.ts
import shaderCode from "@/core/shaders/shaders.wgsl";
import { createShaderModule } from "@/core/utils/webgpu";
import { Mesh } from "./types/gpu";

export class Renderer {
  public device!: GPUDevice;

  // Internal state management
  private canvas: HTMLCanvasElement;
  private context!: GPUCanvasContext;
  private adapter!: GPUAdapter;
  private pipelines = new Map<GPUVertexBufferLayout, GPURenderPipeline>();
  private shaderModule!: GPUShaderModule;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /**
   * Initializes the WebGPU device, context, and pre-compiles the shader module.
   * This must be called before any rendering operations.
   * @throws If WebGPU is not supported or a device cannot be acquired.
   */
  public async init(): Promise<void> {
    await this.setupDevice();
    this.setupContext();
    this.shaderModule = createShaderModule(this.device, shaderCode);
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
    // Check if a pipeline for this specific layout already exists.
    if (this.pipelines.has(layout)) {
      return this.pipelines.get(layout)!;
    }

    // If not, create a new pipeline.
    const newPipeline = this.device.createRenderPipeline({
      layout: "auto",
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
    this.pipelines.set(layout, newPipeline);
    return newPipeline;
  }

  /**
   * Renders a single frame with the provided mesh.
   * @param mesh - The mesh to be rendered.
   */
  public render(mesh: Mesh): void {
    const pipeline = this.getOrCreatePipeline(mesh.layout);

    const textureView = this.context.getCurrentTexture().createView();
    const commandEncoder = this.device.createCommandEncoder();

    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 1.0, g: 1.0, b: 0.0, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    passEncoder.setViewport(0, 0, this.canvas.width, this.canvas.height, 0, 1);
    passEncoder.setPipeline(pipeline);
    passEncoder.setVertexBuffer(0, mesh.buffer);
    passEncoder.draw(mesh.vertexCount, 1, 0, 0);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }
}

// src/core/utils/webgpu.ts

import { TypedArray } from "../types/gpu";

/**
 * Checks if WebGPU is available and requests a GPU adapter.
 *
 * @returns A GPUAdapter promise if available else null.
 * @throws If WebGPU is not supported by the browser.
 */
export const checkWebGPU = async (): Promise<GPUAdapter | null> => {
  if (!navigator.gpu) {
    console.error("WebGPU is not available.");
    throw new Error("WebGPU support is not available");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    console.error("Couldn't request adapter.");
  }

  return adapter;
};

/**
 * Configures a WebGPU canvas context with a basic rendering setup.
 *
 * @param ctx - The GPU canvas context to configure.
 * @param device - The GPU device used for rendering.
 */
export const configureContext = (
  ctx: GPUCanvasContext,
  device: GPUDevice,
): void => {
  const canvasConfig: GPUCanvasConfiguration = {
    device: device,
    format: navigator.gpu.getPreferredCanvasFormat(),
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    alphaMode: "opaque",
  };

  ctx.configure(canvasConfig);
};

/**
 * Creates a shader module from WGSL code.
 *
 * @param device - The GPU device used to create the shader.
 * @param code - The WGSL shader code as a string.
 * @returns A GPUShaderModule compiled from the provided code.
 */
export const createShaderModule = (
  device: GPUDevice,
  code: string,
): GPUShaderModule => {
  return device.createShaderModule({ code });
};

/**
 * Creates and populates a GPUBuffer from a TypedArray.
 *
 * This utility simplifies the common pattern of creating a buffer, mapping it,
 * copying data, and unmapping it.
 *
 * @param device - The GPU device used to create the buffer.
 * @param data - The typed array of data to be copied into the buffer.
 * @param usage - The intended usage for the buffer, specified
 *   using GPUBufferUsage flags (GPUBufferUsage.VERTEX, GPUBufferUsage.COPY_DST etc).
 * @returns The created and populated GPU buffer, now owned by the GPU.
 */
export const createGPUBuffer = (
  device: GPUDevice,
  data: TypedArray,
  usage: GPUBufferUsageFlags,
): GPUBuffer => {
  const bufferDescriptor: GPUBufferDescriptor = {
    size: data.byteLength,
    usage: usage,
    mappedAtCreation: true,
  };

  const gpuBuffer = device.createBuffer(bufferDescriptor);

  // Get the constructor of the typed array (ie Float32Array, Uint16Array etc).
  // allowing to create a new view of the same type on the mapped range.
  const TypedArrayConstructor = data.constructor as new (
    buffer: ArrayBuffer,
  ) => TypedArray;

  // Create a new typed array view of the GPU buffer's mapped range.
  const writeArray = new TypedArrayConstructor(gpuBuffer.getMappedRange());
  writeArray.set(data); // copy the data into the GPU buffer.
  gpuBuffer.unmap(); // unmap buffer, transferring ownership of the memory to the GPU.

  return gpuBuffer;
};

/**
 * Creates a basic render pipeline for drawing triangles using a given shader.
 *
 * @param device - The GPU device used to create the pipeline.
 * @param shaderModule - A compiled GPUShaderModule with vertex and fragment entry points.
 * @param vertexBufferLayout - The layout of the vertex buffer.
 * @returns A configured GPURenderPipeline ready for rendering.
 */
export const createRenderPipeline = (
  device: GPUDevice,
  shaderModule: GPUShaderModule,
  vertexBufferLayout: GPUVertexBufferLayout,
): GPURenderPipeline => {
  return device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [vertexBufferLayout],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
    },
    primitive: {
      topology: "triangle-list",
      frontFace: "ccw",
      cullMode: "back",
    },
  });
};

/**
 * Renders a frame using the given render pipeline and canvas context.
 *
 * @param device - The GPU device used to encode rendering commands.
 * @param ctx - The GPUCanvasContext to render to.
 * @param pipeline - The GPURenderPipeline used for rendering.
 * @param canvas - The target HTML canvas element.
 * @param vertexCount - The number of vertices to draw.
 * @param setupPass - Optional callback to bind additional resources (buffers, uniforms...) to the render pass encoder.
 */
export const renderFrame = (
  device: GPUDevice,
  ctx: GPUCanvasContext,
  pipeline: GPURenderPipeline,
  canvas: HTMLCanvasElement,
  vertexCount: number,
  setupPass?: (encoder: GPURenderPassEncoder) => void,
): void => {
  const textureView = ctx.getCurrentTexture().createView();
  const commandEncoder = device.createCommandEncoder();

  const passEncoder = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: textureView,
        clearValue: { r: 1, g: 1, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });

  passEncoder.setViewport(0, 0, canvas.width, canvas.height, 0, 1);
  passEncoder.setPipeline(pipeline);

  setupPass?.(passEncoder); // Allow external setup logic to bind resources
  passEncoder.draw(vertexCount, 1, 0, 0);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
};

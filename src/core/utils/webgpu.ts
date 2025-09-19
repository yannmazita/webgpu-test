// src/core/utils/webgpu.ts
import { TypedArray } from "@/core/types/gpu";

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
  label?: string,
): GPUBuffer => {
  // Pad the buffer size to a multiple of 4 bytes.
  const paddedSize = Math.max(4, Math.ceil(data.byteLength / 4) * 4);

  const bufferDescriptor: GPUBufferDescriptor = {
    label,
    size: paddedSize,
    usage: usage | GPUBufferUsage.COPY_DST, // ensure we can upload with writeBuffer
    mappedAtCreation: false,
  };

  const gpuBuffer = device.createBuffer(bufferDescriptor);

  // Upload data; respects data.byteOffset/byteLength
  device.queue.writeBuffer(
    gpuBuffer,
    0,
    data.buffer,
    data.byteOffset,
    data.byteLength,
  );

  return gpuBuffer;
};

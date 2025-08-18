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
 * copying data, and unmapping it. It also handles the WebGPU requirement to
 * have buffers size be a multiple of 4 when using mappedAtCreation.
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
  // Pad the buffer size to a multiple of 4 bytes.
  // This is required for buffers created with mappedAtCreation set to true.
  const paddedSize = Math.ceil(data.byteLength / 4) * 4;

  const bufferDescriptor: GPUBufferDescriptor = {
    size: paddedSize,
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

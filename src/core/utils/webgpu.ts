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

/**
 * Queries the GPUDevice for supported compressed texture formats.
 * @param device The GPUDevice to query.
 * @returns A Set containing the string names of supported formats.
 */
export function getSupportedCompressedFormats(
  device: GPUDevice,
): Set<GPUTextureFormat> {
  const supportedFormats = new Set<GPUTextureFormat>();
  const features = device.features;

  // BCn/DXT (Desktop)
  if (features.has("texture-compression-bc")) {
    supportedFormats.add("bc1-rgba-unorm");
    supportedFormats.add("bc1-rgba-unorm-srgb");
    supportedFormats.add("bc2-rgba-unorm");
    supportedFormats.add("bc2-rgba-unorm-srgb");
    supportedFormats.add("bc3-rgba-unorm");
    supportedFormats.add("bc3-rgba-unorm-srgb");
    supportedFormats.add("bc4-r-unorm");
    supportedFormats.add("bc4-r-snorm");
    supportedFormats.add("bc5-rg-unorm");
    supportedFormats.add("bc5-rg-snorm");
    supportedFormats.add("bc6h-rgb-ufloat");
    supportedFormats.add("bc6h-rgb-float");
    supportedFormats.add("bc7-rgba-unorm");
    supportedFormats.add("bc7-rgba-unorm-srgb");
  }

  // ETC2 (Mobile/WebGL standard)
  if (features.has("texture-compression-etc2")) {
    supportedFormats.add("etc2-rgb8unorm");
    supportedFormats.add("etc2-rgb8unorm-srgb");
    supportedFormats.add("etc2-rgb8a1unorm");
    supportedFormats.add("etc2-rgb8a1unorm-srgb");
    supportedFormats.add("etc2-rgba8unorm");
    supportedFormats.add("etc2-rgba8unorm-srgb");
    supportedFormats.add("eac-r11unorm");
    supportedFormats.add("eac-r11snorm");
    supportedFormats.add("eac-rg11unorm");
    supportedFormats.add("eac-rg11snorm");
  }

  // ASTC (Modern Mobile)
  if (features.has("texture-compression-astc")) {
    supportedFormats.add("astc-4x4-unorm");
    supportedFormats.add("astc-4x4-unorm-srgb");
    supportedFormats.add("astc-5x4-unorm");
    supportedFormats.add("astc-5x4-unorm-srgb");
    supportedFormats.add("astc-5x5-unorm");
    supportedFormats.add("astc-5x5-unorm-srgb");
    supportedFormats.add("astc-6x5-unorm");
    supportedFormats.add("astc-6x5-unorm-srgb");
    supportedFormats.add("astc-6x6-unorm");
    supportedFormats.add("astc-6x6-unorm-srgb");
    supportedFormats.add("astc-8x5-unorm");
    supportedFormats.add("astc-8x5-unorm-srgb");
    supportedFormats.add("astc-8x6-unorm");
    supportedFormats.add("astc-8x6-unorm-srgb");
    supportedFormats.add("astc-8x8-unorm");
    supportedFormats.add("astc-8x8-unorm-srgb");
    supportedFormats.add("astc-10x5-unorm");
    supportedFormats.add("astc-10x5-unorm-srgb");
    supportedFormats.add("astc-10x6-unorm");
    supportedFormats.add("astc-10x6-unorm-srgb");
    supportedFormats.add("astc-10x8-unorm");
    supportedFormats.add("astc-10x8-unorm-srgb");
    supportedFormats.add("astc-10x10-unorm");
    supportedFormats.add("astc-10x10-unorm-srgb");
    supportedFormats.add("astc-12x10-unorm");
    supportedFormats.add("astc-12x10-unorm-srgb");
    supportedFormats.add("astc-12x12-unorm");
    supportedFormats.add("astc-12x12-unorm-srgb");
  }

  return supportedFormats;
}

// src/core/rendering/ibl.ts
import equirectToCubemapUrl from "@/core/shaders/equirectToCubemap.wgsl?url";
import { Shader } from "../shaders/shader";
import { ShaderPreprocessor } from "../shaders/preprocessor";

let equirectToCubemapShader: Shader | null = null;
let pipeline: GPUComputePipeline | null = null;

/**
 * Converts an equirectangular HDR texture to a cubemap texture using a compute shader.
 * @param device The GPU device.
 * @param preprocessor The shader preprocessor.
 * @param equirectTexture The source HDR texture.
 * @param cubemapSize The desired size for each face of the cubemap.
 * @returns The generated cubemap GPUTexture.
 */
export async function equirectangularToCubemap(
  device: GPUDevice,
  preprocessor: ShaderPreprocessor,
  equirectTexture: GPUTexture,
  cubemapSize: number,
): Promise<GPUTexture> {
  equirectToCubemapShader ??= await Shader.fromUrl(
    device,
    preprocessor,
    equirectToCubemapUrl,
    "EQUIRECT_TO_CUBEMAP",
    "main",
    "main",
  );

  pipeline ??= device.createComputePipeline({
    label: "EQUIRECT_TO_CUBEMAP_PIPELINE",
    layout: "auto",
    compute: {
      module: equirectToCubemapShader.module,
      entryPoint: "main",
    },
  });

  const cubemapTexture = device.createTexture({
    label: "IBL_CUBEMAP",
    size: [cubemapSize, cubemapSize, 6],
    format: "rgba16float",
    dimension: "2d",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: equirectTexture.createView() },
      {
        binding: 1,
        resource: cubemapTexture.createView({ dimension: "2d-array" }),
      },
    ],
  });

  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  const workgroupCount = Math.ceil(cubemapSize / 8);
  passEncoder.dispatchWorkgroups(workgroupCount, workgroupCount, 6);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);

  return cubemapTexture;
}

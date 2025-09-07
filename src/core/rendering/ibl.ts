// src/core/rendering/ibl.ts
import equirectToCubemapUrl from "@/core/shaders/equirectToCubemap.wgsl?url";
import irradianceUrl from "@/core/shaders/irradiance.wgsl?url";
import prefilterUrl from "@/core/shaders/prefilter.wgsl?url";
import brdfLookupTableUrl from "@/core/shaders/brdf_lookup_table.wgsl?url";
import { Shader } from "../shaders/shader";
import { ShaderPreprocessor } from "../shaders/preprocessor";

// Module-level cache for shaders and pipelines
let equirectToCubemapShader: Shader | null = null;
let equirectToCubemapPipeline: GPUComputePipeline | null = null;

let irradianceShader: Shader | null = null;
let irradiancePipeline: GPUComputePipeline | null = null;

let prefilterShader: Shader | null = null;
let prefilterPipeline: GPUComputePipeline | null = null;
let prefilterParamsBuffer: GPUBuffer | null = null;

let brdfLookupTableShader: Shader | null = null;
let brdfLookupTablePipeline: GPUComputePipeline | null = null;

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

  equirectToCubemapPipeline ??= device.createComputePipeline({
    label: "EQUIRECT_TO_CUBEMAP_PIPELINE",
    layout: "auto",
    compute: {
      module: equirectToCubemapShader.module,
      entryPoint: "main",
    },
  });

  const cubemapTexture = device.createTexture({
    label: "IBL_ENVIRONMENT_CUBEMAP",
    size: [cubemapSize, cubemapSize, 6],
    format: "rgba16float",
    dimension: "2d",
    mipLevelCount: Math.log2(cubemapSize) + 1,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC, // Needed for mip generation
  });

  const bindGroup = device.createBindGroup({
    layout: equirectToCubemapPipeline.getBindGroupLayout(0),
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
  passEncoder.setPipeline(equirectToCubemapPipeline);
  passEncoder.setBindGroup(0, bindGroup);
  const workgroupCount = Math.ceil(cubemapSize / 8);
  passEncoder.dispatchWorkgroups(workgroupCount, workgroupCount, 6);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);

  return cubemapTexture;
}

/**
 * Generates a diffuse irradiance map from an environment cubemap.
 * @param device The GPU device.
 * @param preprocessor The shader preprocessor.
 * @param environmentMap The source environment cubemap.
 * @param sampler A sampler for the environment map.
 * @returns The generated irradiance map GPUTexture.
 */
export async function generateIrradianceMap(
  device: GPUDevice,
  preprocessor: ShaderPreprocessor,
  environmentMap: GPUTexture,
  sampler: GPUSampler,
): Promise<GPUTexture> {
  const IRRADIANCE_MAP_SIZE = 32;

  irradianceShader ??= await Shader.fromUrl(
    device,
    preprocessor,
    irradianceUrl,
    "IRRADIANCE_SHADER",
    "main",
    "main",
  );

  irradiancePipeline ??= device.createComputePipeline({
    label: "IRRADIANCE_PIPELINE",
    layout: "auto",
    compute: { module: irradianceShader.module, entryPoint: "main" },
  });

  const irradianceMap = device.createTexture({
    label: "IBL_IRRADIANCE_MAP",
    size: [IRRADIANCE_MAP_SIZE, IRRADIANCE_MAP_SIZE, 6],
    format: "rgba16float",
    dimension: "2d",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });

  const bindGroup = device.createBindGroup({
    layout: irradiancePipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: environmentMap.createView({ dimension: "cube" }),
      },
      { binding: 1, resource: sampler },
      {
        binding: 2,
        resource: irradianceMap.createView({ dimension: "2d-array" }),
      },
    ],
  });

  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(irradiancePipeline);
  passEncoder.setBindGroup(0, bindGroup);
  const workgroupCount = Math.ceil(IRRADIANCE_MAP_SIZE / 8);
  passEncoder.dispatchWorkgroups(workgroupCount, workgroupCount, 6);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
  return irradianceMap;
}

/**
 * Generates a prefiltered specular map from an environment cubemap.
 * @param device The GPU device.
 * @param preprocessor The shader preprocessor.
 * @param environmentMap The source environment cubemap.
 * @param sampler A sampler for the environment map.
 * @returns The generated prefiltered map GPUTexture.
 */
export async function generatePrefilteredMap(
  device: GPUDevice,
  preprocessor: ShaderPreprocessor,
  environmentMap: GPUTexture,
  sampler: GPUSampler,
): Promise<GPUTexture> {
  prefilterShader ??= await Shader.fromUrl(
    device,
    preprocessor,
    prefilterUrl,
    "PREFILTER_SHADER",
    "main",
    "main",
  );

  prefilterPipeline ??= device.createComputePipeline({
    label: "PREFILTER_PIPELINE",
    layout: "auto",
    compute: { module: prefilterShader.module, entryPoint: "main" },
  });

  prefilterParamsBuffer ??= device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const prefilteredMap = device.createTexture({
    label: "IBL_PREFILTERED_MAP",
    size: [environmentMap.width, environmentMap.height, 6],
    format: "rgba16float",
    dimension: "2d",
    mipLevelCount: environmentMap.mipLevelCount,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });

  const commandEncoder = device.createCommandEncoder();
  const maxMipLevels = environmentMap.mipLevelCount;

  for (let mip = 0; mip < maxMipLevels; mip++) {
    const roughness = mip / (maxMipLevels - 1);
    device.queue.writeBuffer(
      prefilterParamsBuffer,
      0,
      new Float32Array([roughness]),
    );

    const mipSize = environmentMap.width >> mip;

    const bindGroup = device.createBindGroup({
      layout: prefilterPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: environmentMap.createView({ dimension: "cube" }),
        },
        { binding: 1, resource: sampler },
        {
          binding: 2,
          resource: prefilteredMap.createView({
            dimension: "2d-array",
            baseMipLevel: mip,
            mipLevelCount: 1,
          }),
        },
        { binding: 3, resource: { buffer: prefilterParamsBuffer } },
      ],
    });

    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(prefilterPipeline);
    passEncoder.setBindGroup(0, bindGroup);
    const workgroupCount = Math.ceil(mipSize / 8);
    passEncoder.dispatchWorkgroups(workgroupCount, workgroupCount, 6);
    passEncoder.end();
  }

  device.queue.submit([commandEncoder.finish()]);
  return prefilteredMap;
}

/**
 * Generates the BRDF integration lookup table.
 * @param device The GPU device.
 * @param preprocessor The shader preprocessor.
 * @returns The generated 2D LUT GPUTexture.
 */
export async function generateBrdfLut(
  device: GPUDevice,
  preprocessor: ShaderPreprocessor,
): Promise<GPUTexture> {
  const LUT_SIZE = 512;

  brdfLookupTableShader ??= await Shader.fromUrl(
    device,
    preprocessor,
    brdfLookupTableUrl,
    "BRDF_LUT_SHADER",
    "main",
    "main",
  );

  brdfLookupTablePipeline ??= device.createComputePipeline({
    label: "BRDF_LUT_PIPELINE",
    layout: "auto",
    compute: { module: brdfLookupTableShader.module, entryPoint: "main" },
  });

  const brdfLookupTable = device.createTexture({
    label: "IBL_BRDF_LUT",
    size: [LUT_SIZE, LUT_SIZE],
    format: "rg16float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });

  const bindGroup = device.createBindGroup({
    layout: brdfLookupTablePipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: brdfLookupTable.createView() }],
  });

  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(brdfLookupTablePipeline);
  passEncoder.setBindGroup(0, bindGroup);
  const workgroupCount = Math.ceil(LUT_SIZE / 8);
  passEncoder.dispatchWorkgroups(workgroupCount, workgroupCount, 1);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
  return brdfLookupTable;
}

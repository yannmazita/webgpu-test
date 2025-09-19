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
    mipLevelCount: 1,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC, // Needed for potential future mip generation
  });

  const bindGroup = device.createBindGroup({
    layout: equirectToCubemapPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: equirectTexture.createView() },
      {
        binding: 1,
        resource: cubemapTexture.createView({
          dimension: "2d-array",
          baseMipLevel: 0,
          mipLevelCount: 1,
        }),
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
 * Generates a prefiltered specular environment cubemap using a compute shader (Specular IBL).
 *
 * This takes an environment cubemap (typically produced from an equirectangular HDR)
 * and builds a mipmapped cubemap where each mip level encodes increasing roughness.
 * The result is sampled in PBR shading to approximate the specular term efficiently.
 *
 * - The provided environmentMap must be a cubemap texture (viewDimension="cube").
 * - baseSize should be the width/height (in texels) of the desired prefiltered map
 *   at mip level 0. It should be a positive integer (preferably power-of-two).
 * - The number of mip levels is derived as floor(log2(baseSize)) + 1.
 * - Each mip level is processed in a separate compute dispatch targeting the corresponding
 *   storage view on the destination cubemap.
 *
 * @param device The active GPUDevice used to create resources and submit work.
 * @param preprocessor WGSL preprocessor used to resolve shader includes; compiled once and cached.
 * @param environmentMap Source environment cubemap (texture_cube<f32> in WGSL). Only sampled (read-only).
 * @param sampler Sampler used when sampling the environment map.
 * @param baseSize Desired cube face size for the prefiltered output at mip level 0.
 * @returns A Promise resolving to the generated prefiltered cubemap GPUTexture.
 */
export async function generatePrefilteredMap(
  device: GPUDevice,
  preprocessor: ShaderPreprocessor,
  environmentMap: GPUTexture,
  sampler: GPUSampler,
  baseSize: number,
): Promise<GPUTexture> {
  // Lazy-load and cache the shader/pipeline for prefiltering
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

  // Tiny uniform buffer to pass the current roughness per mip
  prefilterParamsBuffer ??= device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Compute the number of mip levels from the requested base size
  const clampedBase = Math.max(1, Math.floor(baseSize));
  const maxMipLevels = Math.floor(Math.log2(clampedBase)) + 1;

  // Destination prefiltered cubemap (storage-binding for compute writes + sampling later)
  const prefilteredMap = device.createTexture({
    label: "IBL_PREFILTERED_MAP",
    size: [clampedBase, clampedBase, 6],
    format: "rgba16float",
    dimension: "2d",
    mipLevelCount: maxMipLevels,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });

  const commandEncoder = device.createCommandEncoder();

  // For each mip level, set roughness in [0..1], create a view into that single mip,
  // and dispatch the compute shader over all faces.
  for (let mip = 0; mip < maxMipLevels; mip++) {
    const roughness = maxMipLevels > 1 ? mip / (maxMipLevels - 1) : 0.0; // avoid NaN if only 1 mip
    device.queue.writeBuffer(
      prefilterParamsBuffer,
      0,
      new Float32Array([roughness]),
    );

    const mipSize = Math.max(1, clampedBase >> mip);

    const bindGroup = device.createBindGroup({
      label: `PREFILTER_BG_MIP_${mip}`,
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

    const pass = commandEncoder.beginComputePass({
      label: `PREFILTER_PASS_MIP_${mip}`,
    });
    pass.setPipeline(prefilterPipeline);
    pass.setBindGroup(0, bindGroup);
    const workgroupCount = Math.ceil(mipSize / 8);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount, 6); // 6 cubemap faces
    pass.end();
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
    format: "rgba16float",
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

// src/client/rendering/ibl.ts
import equirectToCubemapUrl from "@/client/shaders/equirectToCubemap.wgsl?url";
import irradianceUrl from "@/client/shaders/irradiance.wgsl?url";
import prefilterUrl from "@/client/shaders/prefilter.wgsl?url";
import brdfLookupTableUrl from "@/client/shaders/brdf_lookup_table.wgsl?url";
import { Shader } from "@/client/shaders/shader";
import { ShaderPreprocessor } from "@/client/shaders/preprocessor";

/**
 * A container for all pre-compiled GPU resources needed for IBL generation.
 *
 * This class centralizes the asynchronous and expensive creation of shaders and
 * pipelines. An instance of this class should be created and initialized once,
 * then passed to the stateless IBL generation functions.
 */
export class IblPipelines {
  public equirectToCubemapPipeline!: GPUComputePipeline;
  public equirectToCubemapBGL!: GPUBindGroupLayout;
  public irradiancePipeline!: GPUComputePipeline;
  public prefilterPipeline!: GPUComputePipeline;
  public prefilterParamsBuffer!: GPUBuffer;
  public brdfLookupTablePipeline!: GPUComputePipeline;

  private device: GPUDevice;
  private preprocessor: ShaderPreprocessor;

  /**
   * Constructs a new IblPipelines instance.
   * @param device The WebGPU device used to create GPU resources.
   * @param preprocessor The shader preprocessor for resolving includes.
   */
  constructor(device: GPUDevice, preprocessor: ShaderPreprocessor) {
    this.device = device;
    this.preprocessor = preprocessor;
  }

  /**
   * Compiles all shaders and creates all compute pipelines asynchronously.
   * This should be called once before any IBL generation is performed.
   */
  public async initialize(): Promise<void> {
    const device = this.device;
    const preprocessor = this.preprocessor;

    // --- Equirectangular to Cubemap ---
    this.equirectToCubemapBGL = device.createBindGroupLayout({
      label: "EQUIRECT_TO_CUBEMAP_BGL",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: "write-only",
            format: "rgba16float",
            viewDimension: "2d-array",
          },
        },
      ],
    });
    const equirectToCubemapShader = await Shader.fromUrl(
      device,
      preprocessor,
      equirectToCubemapUrl,
      "EQUIRECT_TO_CUBEMAP",
    );
    const equirectPL = device.createPipelineLayout({
      label: "EQUIRECT_TO_CUBEMAP_PL",
      bindGroupLayouts: [this.equirectToCubemapBGL],
    });
    this.equirectToCubemapPipeline = await device.createComputePipelineAsync({
      label: "EQUIRECT_TO_CUBEMAP_PIPELINE",
      layout: equirectPL,
      compute: { module: equirectToCubemapShader.module, entryPoint: "main" },
    });

    // --- Irradiance ---
    const irradianceShader = await Shader.fromUrl(
      device,
      preprocessor,
      irradianceUrl,
      "IRRADIANCE_SHADER",
    );
    this.irradiancePipeline = await device.createComputePipelineAsync({
      label: "IRRADIANCE_PIPELINE",
      layout: "auto",
      compute: { module: irradianceShader.module, entryPoint: "main" },
    });

    // --- Prefilter ---
    const prefilterShader = await Shader.fromUrl(
      device,
      preprocessor,
      prefilterUrl,
      "PREFILTER_SHADER",
    );
    this.prefilterPipeline = await device.createComputePipelineAsync({
      label: "PREFILTER_PIPELINE",
      layout: "auto",
      compute: { module: prefilterShader.module, entryPoint: "main" },
    });
    this.prefilterParamsBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // --- BRDF LUT ---
    const brdfLookupTableShader = await Shader.fromUrl(
      device,
      preprocessor,
      brdfLookupTableUrl,
      "BRDF_LUT_SHADER",
    );
    this.brdfLookupTablePipeline = await device.createComputePipelineAsync({
      label: "BRDF_LUT_PIPELINE",
      layout: "auto",
      compute: { module: brdfLookupTableShader.module, entryPoint: "main" },
    });
  }
}

/**
 * Converts an equirectangular HDR texture to a cubemap texture.
 *
 * @remarks
 * This is a stateless function that executes a compute shader pass. It does not
 * create or cache any pipelines itself.
 *
 * @param device The GPU device.
 * @param pipelines A pre-initialized container with the required GPU pipelines.
 * @param equirectTexture The source HDR texture.
 * @param cubemapSize The desired size for each face of the cubemap.
 * @returns The generated cubemap GPUTexture.
 */
export function equirectangularToCubemap(
  device: GPUDevice,
  pipelines: IblPipelines,
  equirectTexture: GPUTexture,
  cubemapSize: number,
): GPUTexture {
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
      GPUTextureUsage.COPY_SRC,
  });

  const bindGroup = device.createBindGroup({
    label: "EQUIRECT_TO_CUBEMAP_BG",
    layout: pipelines.equirectToCubemapBGL,
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

  const commandEncoder = device.createCommandEncoder({
    label: "EQUIRECT_TO_CUBEMAP_CMDS",
  });
  const passEncoder = commandEncoder.beginComputePass({
    label: "EQUIRECT_TO_CUBEMAP_PASS",
  });
  passEncoder.setPipeline(pipelines.equirectToCubemapPipeline);
  passEncoder.setBindGroup(0, bindGroup);
  const wg = Math.ceil(cubemapSize / 8);
  passEncoder.dispatchWorkgroups(wg, wg, 6);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
  return cubemapTexture;
}

/**
 * Generates a diffuse irradiance map from an environment cubemap.
 *
 * @remarks
 * This is a stateless function that executes a compute shader pass to convolve
 * the environment map into a diffuse irradiance probe.
 *
 * @param device The GPU device.
 * @param pipelines A pre-initialized container with the required GPU pipelines.
 * @param environmentMap The source environment cubemap.
 * @param sampler A sampler for the environment map.
 * @returns The generated irradiance map GPUTexture.
 */
export function generateIrradianceMap(
  device: GPUDevice,
  pipelines: IblPipelines,
  environmentMap: GPUTexture,
  sampler: GPUSampler,
): GPUTexture {
  const IRRADIANCE_MAP_SIZE = 32;

  const irradianceMap = device.createTexture({
    label: "IBL_IRRADIANCE_MAP",
    size: [IRRADIANCE_MAP_SIZE, IRRADIANCE_MAP_SIZE, 6],
    format: "rgba16float",
    dimension: "2d",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });

  const bindGroup = device.createBindGroup({
    layout: pipelines.irradiancePipeline.getBindGroupLayout(0),
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
  passEncoder.setPipeline(pipelines.irradiancePipeline);
  passEncoder.setBindGroup(0, bindGroup);
  const workgroupCount = Math.ceil(IRRADIANCE_MAP_SIZE / 8);
  passEncoder.dispatchWorkgroups(workgroupCount, workgroupCount, 6);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
  return irradianceMap;
}

/**
 * Generates a pre-filtered specular environment cubemap.
 *
 * @remarks
 * This stateless function executes a series of compute passes, one for each
 * mip level of the output texture, to generate the specular IBL probe.
 *
 * @param device The GPU device.
 * @param pipelines A pre-initialized container with the required GPU pipelines.
 * @param environmentMap Source environment cubemap.
 * @param sampler Sampler used when sampling the environment map.
 * @param baseSize Desired cube face size for the pre-filtered output at mip level 0.
 * @returns The generated pre-filtered cubemap GPUTexture.
 */
export function generatePrefilteredMap(
  device: GPUDevice,
  pipelines: IblPipelines,
  environmentMap: GPUTexture,
  sampler: GPUSampler,
  baseSize: number,
): GPUTexture {
  const clampedBase = Math.max(1, Math.floor(baseSize));
  const maxMipLevels = Math.floor(Math.log2(clampedBase)) + 1;

  const prefilteredMap = device.createTexture({
    label: "IBL_PREFILTERED_MAP",
    size: [clampedBase, clampedBase, 6],
    format: "rgba16float",
    dimension: "2d",
    mipLevelCount: maxMipLevels,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });

  const commandEncoder = device.createCommandEncoder();

  for (let mip = 0; mip < maxMipLevels; mip++) {
    const roughness = maxMipLevels > 1 ? mip / (maxMipLevels - 1) : 0.0;
    device.queue.writeBuffer(
      pipelines.prefilterParamsBuffer,
      0,
      new Float32Array([roughness]),
    );

    const mipSize = Math.max(1, clampedBase >> mip);

    const bindGroup = device.createBindGroup({
      label: `PREFILTER_BG_MIP_${mip}`,
      layout: pipelines.prefilterPipeline.getBindGroupLayout(0),
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
        { binding: 3, resource: { buffer: pipelines.prefilterParamsBuffer } },
      ],
    });

    const pass = commandEncoder.beginComputePass({
      label: `PREFILTER_PASS_MIP_${mip}`,
    });
    pass.setPipeline(pipelines.prefilterPipeline);
    pass.setBindGroup(0, bindGroup);
    const workgroupCount = Math.ceil(mipSize / 8);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount, 6);
    pass.end();
  }

  device.queue.submit([commandEncoder.finish()]);
  return prefilteredMap;
}

/**
 * Generates the BRDF integration lookup table.
 *
 * @remarks
 * This is a stateless function that executes a compute shader pass to generate
 * the 2D LUT used to approximate the BRDF component of the PBR specular term.
 *
 * @param device The GPU device.
 * @param pipelines A pre-initialized container with the required GPU pipelines.
 * @returns The generated 2D LUT GPUTexture.
 */
export function generateBrdfLut(
  device: GPUDevice,
  pipelines: IblPipelines,
): GPUTexture {
  const LUT_SIZE = 512;

  const brdfLookupTable = device.createTexture({
    label: "IBL_BRDF_LUT",
    size: [LUT_SIZE, LUT_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });

  const bindGroup = device.createBindGroup({
    layout: pipelines.brdfLookupTablePipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: brdfLookupTable.createView() }],
  });

  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipelines.brdfLookupTablePipeline);
  passEncoder.setBindGroup(0, bindGroup);
  const workgroupCount = Math.ceil(LUT_SIZE / 8);
  passEncoder.dispatchWorkgroups(workgroupCount, workgroupCount, 1);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
  return brdfLookupTable;
}

// src/core/rendering/iblGenerator.ts
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import {
  equirectangularToCubemap,
  generateBrdfLut,
  generateIrradianceMap,
  generatePrefilteredMap,
  IblPipelines,
} from "@/core/rendering/ibl";
import { loadEXR } from "@/loaders/exrLoader";
import { loadHDR } from "@/loaders/hdrLoader";
import { SkyboxMaterial } from "@/core/materials/skyboxMaterial";
import { IBLComponent } from "@/core/ecs/components/iblComponent";

export interface EnvironmentMapResult {
  skyboxMaterial: SkyboxMaterial;
  iblComponent: IBLComponent;
  brdfLut: GPUTexture;
}

export interface IblGeneratorOptions {
  url: string;
  cubemapSize?: number;
  brdfLut?: GPUTexture | null;
}

/**
 * A class for generating Image-Based Lighting (IBL) resources.
 *
 * This class orchestrates the entire pipeline for creating an environment map,
 * including loading the source image, converting it to a cubemap, and
 * pre-computing the necessary textures for physically-based rendering.
 * It owns the pre-compiled GPU pipelines required for these operations.
 */
export class IblGenerator {
  private device: GPUDevice;
  private preprocessor: ShaderPreprocessor;
  private pipelines: IblPipelines;
  private skyboxInitialized = false;

  /**
   * Constructs a new IblGenerator.
   * @param device The WebGPU device.
   * @param preprocessor The shader preprocessor.
   */
  constructor(device: GPUDevice, preprocessor: ShaderPreprocessor) {
    this.device = device;
    this.preprocessor = preprocessor;
    this.pipelines = new IblPipelines(device, preprocessor);
  }

  /**
   * Initializes all necessary GPU pipelines for IBL generation.
   * This must be called before `generate`.
   */
  public async initialize(): Promise<void> {
    await this.pipelines.initialize();
  }

  /**
   * Generates a complete set of IBL resources from a single equirectangular source texture.
   *
   * @remarks
   * This method performs the following steps:
   * 1.  Loads the source `.hdr` or `.exr` file.
   * 2.  Delegates to stateless functions to convert the image to a cubemap.
   * 3.  Delegates to generate the irradiance and pre-filtered maps.
   * 4.  Generates the BRDF lookup table (LUT) if one is not provided.
   * 5.  Packages the results into an `IBLComponent` and a `SkyboxMaterial`.
   *
   * @param options The set of parameters for IBL generation, including the source URL.
   * @returns A promise that resolves to an `EnvironmentMapResult` containing all
   *     the generated GPU resources.
   * @throws If the source image format is not `.hdr` or `.exr`.
   */
  public async generate(
    options: IblGeneratorOptions,
  ): Promise<EnvironmentMapResult> {
    const { url, cubemapSize = 512 } = options;
    const device = this.device;
    console.log(
      `[IblGenerator] Creating environment map from ${url}, size=${cubemapSize}`,
    );

    if (!this.skyboxInitialized) {
      await SkyboxMaterial.initialize(device, this.preprocessor);
      this.skyboxInitialized = true;
    }

    // --- 1. Load and prepare source texture ---
    let imageData: { width: number; height: number; data: Float32Array };
    if (url.endsWith(".hdr")) {
      const hdrData = await loadHDR(url);
      const rgbaData = new Float32Array(hdrData.width * hdrData.height * 4);
      for (let i = 0; i < hdrData.width * hdrData.height; i++) {
        rgbaData[i * 4 + 0] = hdrData.data[i * 3 + 0];
        rgbaData[i * 4 + 1] = hdrData.data[i * 3 + 1];
        rgbaData[i * 4 + 2] = hdrData.data[i * 3 + 2];
        rgbaData[i * 4 + 3] = 1.0;
      }
      imageData = {
        width: hdrData.width,
        height: hdrData.height,
        data: rgbaData,
      };
    } else if (url.endsWith(".exr")) {
      const exrData = await loadEXR(url);
      const { width, height, data } = exrData;
      const flippedData = new Float32Array(data.length);
      const rowSize = width * 4;
      for (let y = 0; y < height; y++) {
        const srcY = height - 1 - y;
        flippedData.set(
          data.subarray(srcY * rowSize, srcY * rowSize + rowSize),
          y * rowSize,
        );
      }
      imageData = { width, height, data: flippedData };
    } else {
      throw new Error(
        `Unsupported environment map format: ${url}. Use .hdr or .exr`,
      );
    }

    const equirectTexture = device.createTexture({
      label: `EQUIRECTANGULAR_SRC:${url}`,
      size: [imageData.width, imageData.height],
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    device.queue.writeTexture(
      { texture: equirectTexture },
      imageData.data.buffer,
      { bytesPerRow: imageData.width * 4 * 4 },
      { width: imageData.width, height: imageData.height },
    );

    // --- 2. Convert to cubemap and pre-compute IBL textures ---
    const environmentMap = equirectangularToCubemap(
      device,
      this.pipelines,
      equirectTexture,
      cubemapSize,
    );
    equirectTexture.destroy();

    const skyboxSampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
    });

    const [irradianceMap, prefilteredMap, brdfLut] = await Promise.all([
      generateIrradianceMap(
        device,
        this.pipelines,
        environmentMap,
        skyboxSampler,
      ),
      generatePrefilteredMap(
        device,
        this.pipelines,
        environmentMap,
        skyboxSampler,
        cubemapSize,
      ),
      options.brdfLut ?? generateBrdfLut(device, this.pipelines),
    ]);

    // --- 3. Create final components ---
    const skyboxTemplate = SkyboxMaterial.createTemplate(device);
    const skyboxMaterial = skyboxTemplate.createInstance(
      environmentMap,
      skyboxSampler,
    );
    const iblComponent = new IBLComponent(
      irradianceMap,
      prefilteredMap,
      brdfLut,
      skyboxSampler,
    );

    return { skyboxMaterial, iblComponent, brdfLut };
  }
}

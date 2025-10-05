// src/core/resources/materialFactory.ts
import { PBRMaterial } from "@/core/materials/pbrMaterial";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { UnlitGroundMaterial } from "@/core/materials/unlitGroundMaterial";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import {
  PBRMaterialOptions,
  UnlitGroundMaterialOptions,
} from "@/core/types/gpu";
import {
  createTextureFromBasis,
  createTextureFromImage,
} from "@/core/utils/texture";

/**
 * A stateless factory for creating Material objects.
 * It handles shader initialization, template creation, and instance creation.
 */
export class MaterialFactory {
  private static pbrInitialized = false;
  private static unlitGroundInitialized = false;

  /**
   * Creates a PBR material template.
   *
   * @remarks
   * This method provides a shared `PBRMaterial` object that acts as a template
   * for creating material instances. This is a performance optimization that
   * avoids redundant shader compilation and pipeline layout creation. It also
   * handles the one-time static initialization of the PBR shader system if it
   * has not been run before.
   *
   * @param device The WebGPU device used for resource creation.
   * @param preprocessor The shader preprocessor for shader compilation.
   * @param options Material properties used to configure the template, such as
   *     determining transparency from the albedo color's alpha channel.
   * @returns A promise that resolves to a `PBRMaterial` template.
   */
  public static async createPBRTemplate(
    device: GPUDevice,
    preprocessor: ShaderPreprocessor,
    options: PBRMaterialOptions = {},
  ): Promise<PBRMaterial> {
    if (!this.pbrInitialized) {
      await PBRMaterial.initialize(device, preprocessor);
      this.pbrInitialized = true;
    }
    const isTransparent = (options.albedo?.[3] ?? 1.0) < 1.0;
    return PBRMaterial.createTemplate(device, isTransparent);
  }

  /**
   * Creates a unique PBR material instance from a template and options.
   *
   * @remarks
   * This method takes a shared `PBRMaterial` template and a specific set of
   * options to create a fully configured `MaterialInstance`. It handles the
   * asynchronous loading and creation of all required GPU textures (like
   * albedo, normal, metallic-roughness) based on the URLs provided in the
   * options. If a texture URL is not provided for a given map, the provided
   * dummy texture is used as a fallback.
   *
   * @param device The WebGPU device used for resource creation.
   * @param supportedCompressedFormats A set of supported GPU texture formats,
   *     used for loading Basis Universal compressed textures.
   * @param dummyTexture A fallback 1x1 GPU texture to use when an optional
   *     texture map is not specified in the options.
   * @param materialTemplate The shared `PBRMaterial` template that defines the
   *     shader and pipeline layout for this instance.
   * @param options An object containing material properties and URLs for the
   *     various texture maps.
   * @param sampler The `GPUSampler` to be used for all textures within this
   *     material instance.
   * @returns A promise that resolves to a new `MaterialInstance`, complete with
   *     its own uniform buffer and bind group.
   */
  public static async createPBRInstance(
    device: GPUDevice,
    supportedCompressedFormats: Set<GPUTextureFormat>,
    dummyTexture: GPUTexture,
    materialTemplate: PBRMaterial,
    options: PBRMaterialOptions = {},
    sampler: GPUSampler,
  ): Promise<MaterialInstance> {
    const loadTexture = (
      url: string | undefined,
      format: GPUTextureFormat,
      isNormalMap = false,
    ): Promise<GPUTexture> => {
      if (!url) return Promise.resolve(dummyTexture);
      if (url.endsWith(".ktx2")) {
        return createTextureFromBasis(
          device,
          supportedCompressedFormats,
          url,
          isNormalMap,
        );
      }
      return createTextureFromImage(device, url, format);
    };

    const [
      albedoTexture,
      metallicRoughnessTexture,
      normalTexture,
      emissiveTexture,
      occlusionTexture,
      specularFactorTexture,
      specularColorTexture,
    ] = await Promise.all([
      loadTexture(options.albedoMap, "rgba8unorm-srgb"),
      loadTexture(options.metallicRoughnessMap, "rgba8unorm"),
      loadTexture(options.normalMap, "rgba8unorm", true),
      loadTexture(options.emissiveMap, "rgba8unorm-srgb"),
      loadTexture(options.occlusionMap, "rgba8unorm"),
      loadTexture(options.specularFactorMap, "rgba8unorm"),
      loadTexture(options.specularColorMap, "rgba8unorm-srgb"),
    ]);

    return materialTemplate.createInstance(
      options,
      albedoTexture,
      metallicRoughnessTexture,
      normalTexture,
      emissiveTexture,
      occlusionTexture,
      specularFactorTexture,
      specularColorTexture,
      sampler,
    );
  }

  /**
   * Creates an instance of the UnlitGroundMaterial.
   *
   * @remarks
   * This method creates a specialized material instance for rendering simple,
   * unlit ground planes. It handles the one-time static initialization of the
   * `UnlitGroundMaterial` shader if it has not been run before. Caching of the
   * resulting `MaterialInstance` is the responsibility of the caller (ie
   * the `ResourceManager`), as these instances are often static and reusable.
   *
   * @param device The WebGPU device used for resource creation.
   * @param preprocessor The shader preprocessor for shader compilation.
   * @param dummyTexture A fallback GPU texture to use if a texture URL is not
   *     provided in the options.
   * @param defaultSampler The default `GPUSampler` to use for the material's
   *     texture.
   * @param options An object containing the material's properties, such as
   *     color and an optional texture URL.
   * @returns A promise that resolves to a new `MaterialInstance`.
   */
  public static async createUnlitGroundMaterial(
    device: GPUDevice,
    preprocessor: ShaderPreprocessor,
    dummyTexture: GPUTexture,
    defaultSampler: GPUSampler,
    options: UnlitGroundMaterialOptions,
  ): Promise<MaterialInstance> {
    if (!this.unlitGroundInitialized) {
      await UnlitGroundMaterial.initialize(device, preprocessor);
      this.unlitGroundInitialized = true;
    }

    const texture = options.textureUrl
      ? await createTextureFromImage(
          device,
          options.textureUrl,
          "rgba8unorm-srgb",
        )
      : dummyTexture;

    const template = UnlitGroundMaterial.getTemplate(device);
    return template.createInstance(options, texture, defaultSampler);
  }
}

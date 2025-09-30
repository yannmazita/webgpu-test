// src/core/materials/pbrMaterial.ts
import { Material } from "./material";
import { PBRMaterialOptions } from "@/core/types/gpu";
import shaderUrl from "@/core/shaders/pbr.wgsl?url";
import { createGPUBuffer } from "../utils/webgpu";
import { Shader } from "@/core/shaders/shader";
import { ShaderPreprocessor } from "../shaders/preprocessor";
import { MaterialInstance } from "./materialInstance";

export class PBRMaterial extends Material {
  // Static resources shared across all PBR materials
  private static shader: Shader | null = null;
  private static layout: GPUBindGroupLayout | null = null;

  /**
   * Initializes the shared resources for all PBR materials.
   *
   * This static method creates the PBR shader and the material-level bind
   * group layout. It must be called once before any `PBRMaterial` instance
   * is created. This approach is used to prevent redundant shader compilation
   * and layout creation, which are expensive operations.
   *
   * @param device The GPU device.
   * @param preprocessor The shader preprocessor.
   */
  public static async initialize(
    device: GPUDevice,
    preprocessor: ShaderPreprocessor,
  ): Promise<void> {
    if (this.shader) return;

    this.shader = await Shader.fromUrl(
      device,
      preprocessor,
      shaderUrl,
      "PBR_SHADER",
    );

    this.layout = device.createBindGroupLayout({
      label: "PBR_MATERIAL_BIND_GROUP_LAYOUT",
      entries: [
        // Albedo texture
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        // Metallic-Roughness texture
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        // Normal texture
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        // Emissive texture
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        // Occlusion texture
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        // KHR_materials_specular: Specular Factor texture
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        // KHR_materials_specular: Specular Color texture
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        // Texture sampler
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        // Material uniforms
        {
          binding: 8,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
  }

  /**
   * Private constructor to create the shared material template.
   * Use PBRMaterial.initialize() and then create instances.
   */
  private constructor(device: GPUDevice, isTransparent: boolean) {
    if (!PBRMaterial.shader || !PBRMaterial.layout) {
      throw new Error(
        "PBRMaterial not initialized. Call PBRMaterial.initialize() first.",
      );
    }
    super(device, PBRMaterial.shader, PBRMaterial.layout, isTransparent);
  }

  /**
   * Creates a new PBRMaterial template if it doesn't exist.
   */
  public static createTemplate(
    device: GPUDevice,
    isTransparent: boolean,
  ): PBRMaterial {
    return new PBRMaterial(device, isTransparent);
  }

  /**
   * Creates a new material instance from this PBR material template.
   *
   * This method takes a set of material options and pre-loaded GPU textures to
   * create a unique `MaterialInstance`. It is responsible for:
   * 1.  Creating a GPU uniform buffer populated with the scalar properties from
   *     the `options` object (like albedo color, metallic factor etc).
   * 2.  Creating a `GPUBindGroup` that binds all the provided textures, the
   *     sampler, and the new uniform buffer to the shader bindings defined by
   *     this material's layout.
   * 3.  Registering uniform updater functions on the new instance, which allows
   *     for efficient, partial updates of material properties for features like
   *     glTF animations.
   *
   * @param options The set of scalar PBR properties for this instance.
   * @param albedoTexture The GPU texture for the base color (albedo).
   * @param metallicRoughnessTexture The GPU texture for metallic (blue channel)
   *     and roughness (green channel). May also contain packed ambient
   *     occlusion (red channel).
   * @param normalTexture The GPU texture for the tangent-space normal map.
   * @param emissiveTexture The GPU texture for self-illumination.
   * @param occlusionTexture The GPU texture for ambient occlusion.
   * @param specularFactorTexture The GPU texture for specular factor (alpha
   *     channel).
   * @param specularColorTexture The GPU texture for specular color (RGB
   *     channels).
   * @param sampler The `GPUSampler` to be used for all textures in this
   *     instance.
   * @returns A new `MaterialInstance` ready for rendering.
   */
  public createInstance(
    options: PBRMaterialOptions,
    albedoTexture: GPUTexture,
    metallicRoughnessTexture: GPUTexture,
    normalTexture: GPUTexture,
    emissiveTexture: GPUTexture,
    occlusionTexture: GPUTexture,
    specularFactorTexture: GPUTexture,
    specularColorTexture: GPUTexture,
    sampler: GPUSampler,
  ): MaterialInstance {
    const uniformBuffer = PBRMaterial.createUniformBuffer(this.device, options);

    const bindGroup = this.device.createBindGroup({
      label: "PBR_MATERIAL_INSTANCE_BIND_GROUP",
      layout: this.materialBindGroupLayout,
      entries: [
        { binding: 0, resource: albedoTexture.createView() },
        { binding: 1, resource: metallicRoughnessTexture.createView() },
        { binding: 2, resource: normalTexture.createView() },
        { binding: 3, resource: emissiveTexture.createView() },
        { binding: 4, resource: occlusionTexture.createView() },
        { binding: 5, resource: specularFactorTexture.createView() },
        { binding: 6, resource: specularColorTexture.createView() },
        { binding: 7, resource: sampler },
        { binding: 8, resource: { buffer: uniformBuffer } },
      ],
    });

    const instance = new MaterialInstance(
      this.device,
      this,
      uniformBuffer,
      bindGroup,
    );

    // Register the updaters for properties that can be animated via KHR_animation_pointer
    instance.registerUniformUpdater(
      "pbrMetallicRoughness/baseColorFactor",
      0,
      4,
    ); // vec4 albedo
    instance.registerUniformUpdater(
      "pbrMetallicRoughness/metallicFactor",
      16,
      1,
    ); // float metallic
    instance.registerUniformUpdater(
      "pbrMetallicRoughness/roughnessFactor",
      20,
      1,
    ); // float roughness
    instance.registerUniformUpdater("emissiveFactor", 32, 3); // vec3 emissive
    instance.registerUniformUpdater(
      "extensions/KHR_materials_specular/specularColorFactor",
      48,
      3,
    ); // vec3 specularColor
    instance.registerUniformUpdater(
      "extensions/KHR_materials_specular/specularFactor",
      60,
      1,
    ); // float specularFactor

    return instance;
  }

  /**
   * Creates and populates the GPU uniform buffer for a PBR material instance.
   *
   * This private static helper method takes a set of material options and packs
   * them into a `Float32Array` according to the precise layout expected by the
   * PBR shader's `MaterialUniforms` struct. It handles default values for any
   * undefined properties in the options object.
   *
   * The packed data includes scalar factors (ie `metallic`, `roughness`),
   * color vectors (`albedo`, `emissive`), boolean-like flags converted to
   * floats (like `hasNormalMap`), and UV set indices. The final array is then
   * used to create a `GPUBuffer` with `UNIFORM` and `COPY_DST` usage, allowing
   * it to be both bound to a shader and updated dynamically for animations.
   *
   * @param device The `GPUDevice` used to create the buffer.
   * @param options The set of PBR properties to be written into the buffer.
   * @returns A new `GPUBuffer` containing the packed material uniform data.
   */
  private static createUniformBuffer(
    device: GPUDevice,
    options: PBRMaterialOptions,
  ): GPUBuffer {
    // Material properties with defaults
    const albedo = options.albedo ?? [1, 1, 1, 1];
    const metallic = options.metallic ?? 0.0;
    const roughness = options.roughness ?? 0.5;
    const normalIntensity = options.normalIntensity ?? 1.0;
    const emissive = options.emissive ?? [0, 0, 0];
    const emissiveStrength = options.emissiveStrength ?? 1.0;
    const occlusionStrength = options.occlusionStrength ?? 1.0;
    const specularFactor = options.specularFactor ?? 1.0;
    const specularColorFactor = options.specularColorFactor ?? [1, 1, 1];
    const uvScale = options.uvScale ?? [1.0, 1.0];

    // Texture flags (1.0 if texture provided, 0.0 otherwise)
    const hasAlbedoMap = options.albedoMap ? 1.0 : 0.0;
    const hasMetallicRoughnessMap = options.metallicRoughnessMap ? 1.0 : 0.0;
    const hasNormalMap = options.normalMap ? 1.0 : 0.0;
    const hasEmissiveMap = options.emissiveMap ? 1.0 : 0.0;
    const hasOcclusionMap = options.occlusionMap ? 1.0 : 0.0;
    const hasSpecularFactorMap = options.specularFactorMap ? 1.0 : 0.0;
    const hasSpecularColorMap = options.specularColorMap ? 1.0 : 0.0;
    const usesPackedOcclusion = options.usePackedOcclusion ? 1.0 : 0.0;

    // UV set indices
    const albedoUV = options.albedoUV ?? 0.0;
    const metallicRoughnessUV = options.metallicRoughnessUV ?? 0.0;
    const normalUV = options.normalUV ?? 0.0;
    const emissiveUV = options.emissiveUV ?? 0.0;
    const occlusionUV = options.occlusionUV ?? 0.0;
    const specularFactorUV = options.specularFactorUV ?? 0.0;
    const specularColorUV = options.specularColorUV ?? 0.0;

    // Pack data: 16-byte aligned for uniform buffer
    const uniformData = new Float32Array(36); // 9 vec4s = 144 bytes

    // vec4 0: albedo
    uniformData.set(albedo, 0);

    // vec4 1: metallic, roughness, normalIntensity, occlusionStrength
    uniformData[4] = metallic;
    uniformData[5] = roughness;
    uniformData[6] = normalIntensity;
    uniformData[7] = occlusionStrength;

    // vec4 2: emissive (rgb) + emissiveStrength in .w
    uniformData.set([...emissive, emissiveStrength], 8);

    // vec4 3: specularColorFactor (rgb) + specularFactor (w)
    uniformData.set([...specularColorFactor, specularFactor], 12);

    // vec4 4: texture flags 1 (hasAlbedo, hasMR, hasNormal, hasEmissive)
    uniformData[16] = hasAlbedoMap;
    uniformData[17] = hasMetallicRoughnessMap;
    uniformData[18] = hasNormalMap;
    uniformData[19] = hasEmissiveMap;

    // vec4 5: texture flags 2 (hasOcclusion, hasSpecularFactorMap, hasSpecularColorMap, usesPackedOcclusion)
    uniformData[20] = hasOcclusionMap;
    uniformData[21] = hasSpecularFactorMap;
    uniformData[22] = hasSpecularColorMap;
    uniformData[23] = usesPackedOcclusion;

    // vec4 6: texture UV indices 1 (albedo, mr, normal, emissive)
    uniformData[24] = albedoUV;
    uniformData[25] = metallicRoughnessUV;
    uniformData[26] = normalUV;
    uniformData[27] = emissiveUV;

    // vec4 7: texture UV indices 2 (occlusion, specularFactor, specularColor, pad)
    uniformData[28] = occlusionUV;
    uniformData[29] = specularFactorUV;
    uniformData[30] = specularColorUV;
    uniformData[31] = 0.0; // padding

    // vec4 8: uvScale (xy) + padding
    uniformData.set(uvScale, 32);
    uniformData[34] = 0.0; // padding
    uniformData[35] = 0.0; // padding

    return createGPUBuffer(
      device,
      uniformData,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      "PBR_MATERIAL_UNIFORM_BUFFER",
    );
  }
}

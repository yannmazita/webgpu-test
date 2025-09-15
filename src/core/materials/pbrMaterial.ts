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
        // Texture sampler
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        // Material uniforms
        {
          binding: 6,
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
   * Creates a new instance from this material template.
   */
  public createInstance(
    options: PBRMaterialOptions,
    albedoTexture: GPUTexture,
    metallicRoughnessTexture: GPUTexture,
    normalTexture: GPUTexture,
    emissiveTexture: GPUTexture,
    occlusionTexture: GPUTexture,
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
        { binding: 5, resource: sampler },
        { binding: 6, resource: { buffer: uniformBuffer } },
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

    return instance;
  }

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
    const occlusionStrength = options.occlusionStrength ?? 1.0;

    // Texture flags (1.0 if texture provided, 0.0 otherwise)
    const hasAlbedoMap = options.albedoMap ? 1.0 : 0.0;
    const hasMetallicRoughnessMap = options.metallicRoughnessMap ? 1.0 : 0.0;
    const hasNormalMap = options.normalMap ? 1.0 : 0.0;
    const hasEmissiveMap = options.emissiveMap ? 1.0 : 0.0;
    const hasOcclusionMap = options.occlusionMap ? 1.0 : 0.0;

    // UV set indices
    const albedoUV = options.albedoUV ?? 0.0;
    const metallicRoughnessUV = options.metallicRoughnessUV ?? 0.0;
    const normalUV = options.normalUV ?? 0.0;
    const emissiveUV = options.emissiveUV ?? 0.0;
    const occlusionUV = options.occlusionUV ?? 0.0;

    // Pack data: 16-byte aligned for uniform buffer
    const uniformData = new Float32Array(24); // 6 vec4s = 96 bytes

    // vec4: albedo
    uniformData.set(albedo, 0);

    // vec4: metallic, roughness, normalIntensity, occlusionStrength
    uniformData[4] = metallic;
    uniformData[5] = roughness;
    uniformData[6] = normalIntensity;
    uniformData[7] = occlusionStrength;

    // vec4: emissive + padding
    uniformData.set([...emissive, 0.0], 8);

    // vec4: texture flags (hasAlbedo, hasMetallicRoughness, hasNormal, hasEmissive)
    uniformData[12] = hasAlbedoMap;
    uniformData[13] = hasMetallicRoughnessMap;
    uniformData[14] = hasNormalMap;
    uniformData[15] = hasEmissiveMap;

    // vec4: texture UV indices (albedo, mr, normal, emissive)
    uniformData[16] = albedoUV;
    uniformData[17] = metallicRoughnessUV;
    uniformData[18] = normalUV;
    uniformData[19] = emissiveUV;

    // vec4: texture flags 2 (hasOcclusion, occlusionUV, pad, pad)
    uniformData[20] = hasOcclusionMap;
    uniformData[21] = occlusionUV;
    uniformData[22] = 0.0; // padding
    uniformData[23] = 0.0; // padding

    return createGPUBuffer(
      device,
      uniformData,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      "PBR_MATERIAL_UNIFORM_BUFFER",
    );
  }
}

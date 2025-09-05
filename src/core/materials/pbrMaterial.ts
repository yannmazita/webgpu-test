import { Material } from "./material";
import { PBRMaterialOptions } from "@/core/types/gpu";
import shaderUrl from "@/core/shaders/pbr.wgsl?url";
import { createGPUBuffer } from "../utils/webgpu";
import { Shader } from "@/core/shaders/shader";
import { ShaderPreprocessor } from "../shaders/preprocessor";

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
   * Creates a new PBR Material instance.
   */
  constructor(
    device: GPUDevice,
    options: PBRMaterialOptions,
    albedoTexture: GPUTexture,
    metallicRoughnessTexture: GPUTexture,
    normalTexture: GPUTexture,
    emissiveTexture: GPUTexture,
    occlusionTexture: GPUTexture,
    sampler: GPUSampler,
  ) {
    if (!PBRMaterial.shader || !PBRMaterial.layout) {
      throw new Error(
        "PBRMaterial not initialized. Call PBRMaterial.initialize() first.",
      );
    }

    const uniformBuffer = PBRMaterial.createUniformBuffer(device, options);

    const bindGroup = device.createBindGroup({
      label: "PBR_MATERIAL_BIND_GROUP",
      layout: PBRMaterial.layout,
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

    const albedo = options.albedo ?? [1, 1, 1, 1];
    const isTransparent = albedo[3] < 1.0;

    super(
      device,
      PBRMaterial.shader,
      PBRMaterial.layout,
      bindGroup,
      isTransparent,
    );
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

    // Pack data: 16-byte aligned for uniform buffer
    const uniformData = new Float32Array(16); // 64 bytes total

    // vec4: albedo
    uniformData.set(albedo, 0);

    // vec4: metallic, roughness, normalIntensity, occlusionStrength
    uniformData[4] = metallic;
    uniformData[5] = roughness;
    uniformData[6] = normalIntensity;
    uniformData[7] = occlusionStrength;

    // vec4: emissive + padding
    uniformData.set([...emissive, 0.0], 8);

    // vec4: texture flags
    uniformData[12] = hasAlbedoMap;
    uniformData[13] = hasMetallicRoughnessMap;
    uniformData[14] = hasNormalMap;
    uniformData[15] = hasEmissiveMap;
    // Note: hasOcclusionMap would go in next vec4 if needed

    return createGPUBuffer(
      device,
      uniformData,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      "PBR_MATERIAL_UNIFORM_BUFFER",
    );
  }
}

// src/core/materials/phongMaterial.ts
import { Material } from "./material";
import { PhongMaterialOptions } from "@/core/types/gpu";
import shaderUrl from "@/core/shaders/phong.wgsl?url";
import { createGPUBuffer } from "../utils/webgpu";
import { Shader } from "@/core/shaders/shader";
import { ShaderPreprocessor } from "../shaders/preprocessor";

export class PhongMaterial extends Material {
  // Static resources shared across all PhongMaterial instances
  private static shader: Shader | null = null;
  private static layout: GPUBindGroupLayout | null = null;

  /**
   * Initializes the shared shader and layout for all Phong materials.
   * This must be called once before any PhongMaterial is instantiated.
   * @param device The GPUDevice.
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
      "PHONG_SHADER",
    );

    this.layout = device.createBindGroupLayout({
      label: "PHONG_MATERIAL_BIND_GROUP_LAYOUT",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
  }

  /**
   * Creates a new Material instance configured for Phong shading.
   * @param device The GPUDevice.
   * @param options The material properties.
   * @param texture The texture to apply.
   * @param sampler The sampler for the texture.
   */
  constructor(
    device: GPUDevice,
    options: PhongMaterialOptions,
    texture: GPUTexture,
    sampler: GPUSampler,
  ) {
    if (!PhongMaterial.shader || !PhongMaterial.layout) {
      throw new Error(
        "PhongMaterial not initialized. Call PhongMaterial.initialize() first.",
      );
    }

    const uniformBuffer = PhongMaterial.createUniformBuffer(
      device,
      options,
      !!options.textureUrl,
    );

    const bindGroup = device.createBindGroup({
      label: "PHONG_MATERIAL_BIND_GROUP",
      layout: PhongMaterial.layout,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    const baseColor = options.baseColor ?? [1, 1, 1, 1];
    const isTransparent = baseColor[3] < 1.0;

    super(
      device,
      PhongMaterial.shader,
      PhongMaterial.layout,
      bindGroup,
      isTransparent,
    );
  }

  private static createUniformBuffer(
    device: GPUDevice,
    options: PhongMaterialOptions,
    hasTexture: boolean,
  ): GPUBuffer {
    const baseColor = options.baseColor ?? [1, 1, 1, 1];
    const specularColor = options.specularColor ?? [1, 1, 1];
    const shininess = options.shininess ?? 32.0;

    const uniformData = new Float32Array(12);
    uniformData.set(baseColor, 0);
    uniformData.set(specularColor, 4);
    uniformData[8] = shininess;
    uniformData[9] = hasTexture ? 1.0 : 0.0;

    return createGPUBuffer(
      device,
      uniformData,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      "PHONG_MATERIAL_UNIFORM_BUFFER",
    );
  }
}

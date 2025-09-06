// src/core/materials/unlitGroundMaterial.ts
import { Material } from "./material";
import unlitGroundShaderUrl from "@/core/shaders/unlitGround.wgsl?url";
import { Shader } from "@/core/shaders/shader";
import { ShaderPreprocessor } from "../shaders/preprocessor";
import { UnlitGroundMaterialOptions } from "../types/gpu";
import { createGPUBuffer } from "../utils/webgpu";

export class UnlitGroundMaterial extends Material {
  private static shader: Shader | null = null;
  private static layout: GPUBindGroupLayout | null = null;

  public static async initialize(
    device: GPUDevice,
    preprocessor: ShaderPreprocessor,
  ): Promise<void> {
    if (this.shader) return;

    this.shader = await Shader.fromUrl(
      device,
      preprocessor,
      unlitGroundShaderUrl,
      "UNLIT_SKYBOX_SHADER",
      "vs_main",
      "fs_main",
    );

    this.layout = device.createBindGroupLayout({
      label: "UNLIT_SKYBOX_MATERIAL_BIND_GROUP_LAYOUT",
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

  constructor(
    device: GPUDevice,
    options: UnlitGroundMaterialOptions,
    texture: GPUTexture,
    sampler: GPUSampler,
  ) {
    if (!UnlitGroundMaterial.shader || !UnlitGroundMaterial.layout) {
      throw new Error(
        "UnlitGroundMaterial not initialized. Call UnlitGroundMaterial.initialize() first.",
      );
    }

    // Create uniform buffer
    const uniformData = new Float32Array(8); // 2x vec4
    const color = options.color ?? [1, 1, 1, 1];
    const useTexture = options.textureUrl ? 1.0 : 0.0;
    uniformData.set(color, 0);
    uniformData[4] = useTexture;

    const uniformBuffer = createGPUBuffer(
      device,
      uniformData,
      GPUBufferUsage.UNIFORM,
      "UNLIT_SKYBOX_MATERIAL_UNIFORMS",
    );

    const bindGroup = device.createBindGroup({
      label: "UNLIT_SKYBOX_MATERIAL_BIND_GROUP",
      layout: UnlitGroundMaterial.layout,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    super(
      device,
      UnlitGroundMaterial.shader,
      UnlitGroundMaterial.layout,
      bindGroup,
      false,
    );
  }
}

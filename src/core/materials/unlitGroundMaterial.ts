// src/core/materials/unlitGroundMaterial.ts
import { Material } from "./material";
import unlitGroundShaderUrl from "@/core/shaders/unlitGround.wgsl?url";
import { Shader } from "@/core/shaders/shader";
import { ShaderPreprocessor } from "../shaders/preprocessor";
import { UnlitGroundMaterialOptions } from "../types/gpu";
import { createGPUBuffer } from "../utils/webgpu";
import { MaterialInstance } from "./materialInstance";

export class UnlitGroundMaterial extends Material {
  private static shader: Shader | null = null;
  private static layout: GPUBindGroupLayout | null = null;
  private static template: UnlitGroundMaterial | null = null;

  public static async initialize(
    device: GPUDevice,
    preprocessor: ShaderPreprocessor,
  ): Promise<void> {
    if (this.shader) return;

    this.shader = await Shader.fromUrl(
      device,
      preprocessor,
      unlitGroundShaderUrl,
      "UNLIT_GROUND_SHADER",
      "vs_main",
      "fs_main",
    );

    this.layout = device.createBindGroupLayout({
      label: "UNLIT_GROUND_MATERIAL_BIND_GROUP_LAYOUT",
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

  private constructor(device: GPUDevice) {
    if (!UnlitGroundMaterial.shader || !UnlitGroundMaterial.layout) {
      throw new Error(
        "UnlitGroundMaterial not initialized. Call UnlitGroundMaterial.initialize() first.",
      );
    }
    // Unlit ground is never transparent
    super(
      device,
      UnlitGroundMaterial.shader,
      UnlitGroundMaterial.layout,
      false,
    );
  }

  public static getTemplate(device: GPUDevice): UnlitGroundMaterial {
    this.template ??= new UnlitGroundMaterial(device);
    return this.template;
  }

  public createInstance(
    options: UnlitGroundMaterialOptions,
    texture: GPUTexture,
    sampler: GPUSampler,
  ): MaterialInstance {
    // Create uniform buffer
    const uniformData = new Float32Array(8); // 2x vec4
    const color = options.color ?? [1, 1, 1, 1];
    const useTexture = options.textureUrl ? 1.0 : 0.0;
    uniformData.set(color, 0);
    uniformData[4] = useTexture;

    const uniformBuffer = createGPUBuffer(
      this.device,
      uniformData,
      GPUBufferUsage.UNIFORM,
      "UNLIT_GROUND_MATERIAL_UNIFORMS",
    );

    const bindGroup = this.device.createBindGroup({
      label: "UNLIT_GROUND_MATERIAL_INSTANCE_BIND_GROUP",
      layout: this.materialBindGroupLayout,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    return new MaterialInstance(this.device, this, uniformBuffer, bindGroup);
  }
}

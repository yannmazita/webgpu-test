// src/core/shader.ts
import { ShaderPreprocessor } from "./preprocessor";

export class Shader {
  public readonly module: GPUShaderModule;
  public readonly vertexEntryPoint: string;
  public readonly fragmentEntryPoint: string;

  constructor(
    device: GPUDevice,
    code: string,
    label?: string,
    vertexEntryPoint = "vs_main",
    fragmentEntryPoint = "fs_main",
  ) {
    this.module = device.createShaderModule({ label, code });
    this.vertexEntryPoint = vertexEntryPoint;
    this.fragmentEntryPoint = fragmentEntryPoint;
  }

  public static async fromUrl(
    device: GPUDevice,
    preprocessor: ShaderPreprocessor,
    url: string,
    label?: string,
    vertexEntryPoint = "vs_main",
    fragmentEntryPoint = "fs_main",
  ): Promise<Shader> {
    const absoluteUrl = new URL(url, window.location.href).href;
    const processedCode = await preprocessor.process(absoluteUrl);
    return new Shader(
      device,
      processedCode,
      label,
      vertexEntryPoint,
      fragmentEntryPoint,
    );
  }
}

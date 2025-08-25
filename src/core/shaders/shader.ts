// src/core/shader.ts
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
}

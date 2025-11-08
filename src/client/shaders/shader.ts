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

  /**
   * Creates a new shader from a URL.
   *
   * This static method fetches the shader source code from the given URL,
   * processes it with the provided preprocessor, and then creates a new
   * `Shader` instance.
   *
   * @param device The GPU device.
   * @param preprocessor The shader preprocessor.
   * @param url The URL of the shader source file.
   * @param label An optional label for the shader module.
   * @param vertexEntryPoint The name of the vertex shader entry point
   *     function.
   * @param fragmentEntryPoint The name of the fragment shader entry point
   *     function.
   * @returns A promise that resolves to the new `Shader` instance.
   */
  public static async fromUrl(
    device: GPUDevice,
    preprocessor: ShaderPreprocessor,
    url: string,
    label?: string,
    vertexEntryPoint = "vs_main",
    fragmentEntryPoint = "fs_main",
  ): Promise<Shader> {
    // Use module URL when available; fallback to globalThis.location if present
    const baseUrl =
      (import.meta as { url: string } | undefined)?.url ??
      (globalThis as unknown as { location: { href: string } } | undefined)
        ?.location?.href;
    const absoluteUrl = baseUrl ? new URL(url, baseUrl).href : url;

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

// src/core/rendering/passes/skyboxPass.ts
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Renderer } from "@/core/renderer";

export class SkyboxPass {
  public record(
    passEncoder: GPURenderPassEncoder,
    skyboxMaterial: MaterialInstance,
    frameBindGroupLayout: GPUBindGroupLayout,
    canvasFormat: GPUTextureFormat,
    depthFormat: GPUTextureFormat,
  ): void {
    const pipeline = skyboxMaterial.material.getPipeline(
      [],
      Renderer.INSTANCE_DATA_LAYOUT,
      frameBindGroupLayout,
      canvasFormat,
      depthFormat,
    );
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(1, skyboxMaterial.bindGroup);
    passEncoder.draw(3, 1, 0, 0);
  }
}

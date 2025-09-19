// src/core/rendering/passes/opaquePass.ts
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Renderer } from "@/core/renderer";

export interface DrawBatch {
  pipeline: GPURenderPipeline;
  materialInstance: MaterialInstance;
  mesh: Mesh;
  instanceCount: number;
  firstInstance: number;
}

export class OpaquePass {
  public record(
    passEncoder: GPURenderPassEncoder,
    batches: DrawBatch[],
    instanceBuffer: GPUBuffer,
  ): number {
    if (batches.length === 0) return 0;

    let lastMaterialInstance: MaterialInstance | null = null;
    let lastMesh: Mesh | null = null;

    for (const batch of batches) {
      const mesh = batch.mesh;
      passEncoder.setPipeline(batch.pipeline);

      if (batch.materialInstance !== lastMaterialInstance) {
        passEncoder.setBindGroup(1, batch.materialInstance.bindGroup);
        lastMaterialInstance = batch.materialInstance;
      }

      if (mesh !== lastMesh) {
        for (let i = 0; i < mesh.buffers.length; i++) {
          passEncoder.setVertexBuffer(i, mesh.buffers[i]);
        }

        if (mesh.indexBuffer) {
          passEncoder.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat!);
        }
        lastMesh = mesh;
      }

      const instanceSlot = mesh.buffers.length;
      const instanceByteOffset =
        batch.firstInstance * (Renderer as any).INSTANCE_BYTE_STRIDE;
      passEncoder.setVertexBuffer(
        instanceSlot,
        instanceBuffer,
        instanceByteOffset,
      );

      if (mesh.indexBuffer) {
        passEncoder.drawIndexed(mesh.indexCount!, batch.instanceCount, 0, 0, 0);
      } else {
        passEncoder.draw(mesh.vertexCount, batch.instanceCount, 0, 0);
      }
    }

    return batches.length;
  }
}

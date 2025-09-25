// src/core/rendering/passes/opaquePass.ts
import { DrawBatch } from "@/core/types/renderer";
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Renderer } from "@/core/rendering/renderer";

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
          passEncoder.setIndexBuffer(
            mesh.indexBuffer,
            mesh.indexFormat ?? "uint32",
          );
        }
        lastMesh = mesh;
      }

      const instanceSlot = mesh.buffers.length;
      const instanceByteOffset =
        batch.firstInstance * Renderer.INSTANCE_BYTE_STRIDE;
      passEncoder.setVertexBuffer(
        instanceSlot,
        instanceBuffer,
        instanceByteOffset,
      );

      if (mesh.indexBuffer) {
        passEncoder.drawIndexed(
          mesh.indexCount ?? 0,
          batch.instanceCount,
          0,
          0,
          0,
        );
      } else {
        passEncoder.draw(mesh.vertexCount, batch.instanceCount, 0, 0);
      }
    }

    return batches.length;
  }
}

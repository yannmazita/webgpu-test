// src/core/rendering/passes/opaquePass.ts
import { DrawBatch } from "@/core/types/renderer";
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Renderer } from "@/core/rendering/renderer";
import { RenderContext, RenderPass } from "@/core/types/rendering";
import { BatchManager } from "@/core/rendering/batchManager";
import { Material } from "@/core/materials/material";

/**
 * Renders all opaque geometry for the main scene pass using a PBR shader.
 *
 * @remarks
 * This pass is responsible for drawing the bulk of the scene's geometry. It
 * uses an internal `BatchManager` to group objects by their render pipeline,
 * mesh, and material. This strategy minimizes redundant state changes and API
 * calls, allowing many objects to be drawn with a small number of efficient,
 * instanced draw calls.
 *
 * The pass uses a PBR (Physically-Based Rendering) shader
 * (`pbr.wgsl`) that calculates realistic lighting. The shader's key features,
 * executed per-fragment, include:
 * - **Direct Lighting**: It combines contributions from both the main sun and
 *   numerous point/spot lights. Point/spot light influence is determined
 *   efficiently via a clustered forward rendering implementation.
 * - **Shadowing**: It determines the appropriate shadow cascade for the fragment,
 *   projects its position into the sun's view, and performs a 3x3 PCF
 *   (Percentage-Closer Filtering) sample on the shadow map to calculate
 *   shadow intensity.
 * - **Indirect Lighting**: It calculates both diffuse and specular image-based
 *   lighting (IBL) by sampling the scene's irradiance and prefiltered
 *   environment maps.
 * - **Effects**: It applies volumetric fog and concludes with ACES filmic
 *   tone mapping for a cinematic look.
 *
 * The vertex shader handles non-uniform scaling by transforming
 * normals with the inverse-transpose of the model matrix.
 */
export class OpaquePass implements RenderPass {
  private batchManager: BatchManager;

  /**
   * Initializes the pass and its internal `BatchManager`.
   */
  constructor() {
    this.batchManager = new BatchManager();
  }

  /**
   * Executes the opaque rendering pass.
   *
   * @remarks
   * This method orchestrates the entire process of rendering opaque objects.
   * It pulls the full list of visible renderables from the context, filters
   * them, batches them for efficiency, and records the final drawing commands.
   *
   * @param context The immutable render context for the current frame.
   * @param passEncoder The `GPURenderPassEncoder` for the main scene pass,
   *   into which the opaque geometry will be drawn.
   * @returns The total number of draw calls issued by the pass.
   */
  public execute(
    context: RenderContext,
    passEncoder: GPURenderPassEncoder,
  ): number {
    // 1. Filter opaque renderables from all visible objects
    const opaqueRenderables = context.sceneData.renderables.filter(
      (r) => !r.material.material.isTransparent,
    );
    if (opaqueRenderables.length === 0) return 0;

    // 2. Define a callback to get pipelines
    const getPipelineCallback = (material: Material, mesh: Mesh) =>
      material.getPipeline(
        mesh.layouts,
        Renderer.INSTANCE_DATA_LAYOUT,
        context.frameBindGroupLayout,
        context.canvasFormat,
        context.depthFormat,
      );

    // 3. Get batches from the internal manager
    const opaquePipelineBatches = this.batchManager.getOpaqueBatches(
      opaqueRenderables,
      getPipelineCallback,
    );

    // 4. Convert to a flat list of draw batches, calculating instance offsets
    const batches: DrawBatch[] = [];
    let currentInstanceOffset = 0;
    for (const [, pipelineBatch] of opaquePipelineBatches.entries()) {
      for (const drawGroup of pipelineBatch.drawGroups) {
        if (drawGroup.instances.length === 0) continue;

        batches.push({
          pipeline: getPipelineCallback(
            drawGroup.materialInstance.material,
            drawGroup.mesh,
          ),
          materialInstance: drawGroup.materialInstance,
          mesh: drawGroup.mesh,
          instanceCount: drawGroup.instances.length,
          firstInstance:
            context.instanceAllocations.opaques.offset + currentInstanceOffset,
        });

        // Increment the offset by the number of instances in this group for the next one.
        currentInstanceOffset += drawGroup.instances.length;
      }
    }

    // 5. Record draw calls
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
        context.instanceBuffer,
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

// src/client/rendering/passes/transparentPass.ts
import { Vec3, vec3 } from "wgpu-matrix";
import { Renderer } from "@/client/rendering/renderer";
import { RenderContext, RenderPass } from "@/client/types/rendering";

/**
 * Renders all alpha-blended (transparent) geometry for the main scene pass.
 *
 * @remarks
 * The primary challenge with rendering transparent objects is ensuring correct
 * visual layering. To achieve this, the pass performs a crucial back-to-front
 * sort of all transparent objects based on each object's distance from the
 * camera. This ensures that objects farther away are drawn before closer ones,
 * allowing their colors to blend correctly.
 *
 * This pass reuses the same feature-rich `pbr.wgsl` shader as the `OpaquePass`.
 * As a result, transparent objects receive the full suite of lighting effects,
 * including direct lighting from clusters, sun shadows, and image-based
 * lighting (IBL). This allows for realistic rendering of materials like glass
 * or colored plastics that still have specular highlights and are affected by
 * scene lighting.
 *
 * For efficiency, the pass attempts to batch consecutive, sorted objects that
 * share the same mesh and material into single instanced draw calls. However,
 * the sorting requirement often results in more draw calls compared to the
 * opaque pass.
 *
 * The actual alpha blending is not performed in the shader itself but is
 * enabled by the GPU's pipeline state, which is configured by the material to
 * combine the fragment shader's output color with the color already in the
 * framebuffer.
 */
export class TransparentPass implements RenderPass {
  private tempVec3A: Vec3 = vec3.create();
  private tempVec3B: Vec3 = vec3.create();
  private tempCameraPos: Vec3 = vec3.create();

  /**
   * Executes the transparent rendering pass.
   *
   * @remarks
   * It filters for transparent objects from the context, sorts them
   * back-to-front relative to the camera, and then records the necessary draw
   * commands into the provided render pass encoder.
   *
   * @param context The immutable render context for the current frame.
   * @param passEncoder The `GPURenderPassEncoder` for the main scene pass,
   *   into which the transparent geometry will be drawn.
   * @returns The total number of draw calls issued by the pass.
   */
  public execute(
    context: RenderContext,
    passEncoder: GPURenderPassEncoder,
  ): number {
    const {
      camera,
      instanceBuffer,
      instanceAllocations,
      frameBindGroupLayout,
      canvasFormat,
      depthFormat,
    } = context;

    // 1. Filter transparent renderables
    const renderables = context.sceneData.renderables.filter(
      (r) => r.material.material.isTransparent,
    );

    if (renderables.length === 0) return 0;

    // 2. Sort back-to-front
    this.tempCameraPos[0] = camera.inverseViewMatrix[12];
    this.tempCameraPos[1] = camera.inverseViewMatrix[13];
    this.tempCameraPos[2] = camera.inverseViewMatrix[14];

    renderables.sort((a, b) => {
      this.tempVec3A[0] = a.modelMatrix[12];
      this.tempVec3A[1] = a.modelMatrix[13];
      this.tempVec3A[2] = a.modelMatrix[14];
      this.tempVec3B[0] = b.modelMatrix[12];
      this.tempVec3B[1] = b.modelMatrix[13];
      this.tempVec3B[2] = b.modelMatrix[14];
      const da = vec3.distanceSq(this.tempVec3A, this.tempCameraPos);
      const db = vec3.distanceSq(this.tempVec3B, this.tempCameraPos);
      return db - da;
    });

    // 3. Record draw calls (instance data is already on GPU)
    const instanceBufferOffset =
      instanceAllocations.transparents.offset * Renderer.INSTANCE_BYTE_STRIDE;

    let drawCalls = 0;
    let i = 0;
    while (i < renderables.length) {
      const { mesh, material } = renderables[i];
      const pipeline = material.material.getPipeline(
        mesh.layouts,
        Renderer.INSTANCE_DATA_LAYOUT,
        frameBindGroupLayout,
        canvasFormat,
        depthFormat,
      );

      let count = 1;
      while (
        i + count < renderables.length &&
        renderables[i + count].mesh === mesh &&
        renderables[i + count].material === material
      ) {
        count++;
      }

      passEncoder.setPipeline(pipeline);
      passEncoder.setBindGroup(1, material.bindGroup);

      for (let j = 0; j < mesh.buffers.length; j++) {
        passEncoder.setVertexBuffer(j, mesh.buffers[j]);
      }

      const groupByteOffset =
        instanceBufferOffset + i * Renderer.INSTANCE_BYTE_STRIDE;
      passEncoder.setVertexBuffer(
        mesh.layouts.length,
        instanceBuffer,
        groupByteOffset,
      );

      if (mesh.indexBuffer) {
        passEncoder.drawIndexed(mesh.indexCount ?? 0, count, 0, 0, 0);
      } else {
        passEncoder.draw(mesh.vertexCount, count, 0, 0);
      }

      drawCalls++;
      i += count;
    }

    return drawCalls;
  }
}

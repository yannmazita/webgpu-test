// src/client/rendering/passes/skyboxPass.ts
import { Renderer } from "@/client/rendering/renderer";
import { RenderContext, RenderPass } from "@/client/types/rendering";

/**
 * Renders the scene's skybox.
 *
 * @remarks
 * This pass is responsible for drawing the environment cubemap behind all other
 * geometry. It employs a highly optimized technique that avoids the need for
 * any vertex buffers.
 *
 * The rendering process works as follows:
 * 1. A single draw call renders three vertices, which the vertex shader
 *    procedurally expands into a single triangle that covers the entire viewport.
 * 2. The vertex shader calculates the world-space view direction for each pixel
 *    by unprojecting the screen coordinates using the camera's inverse
 *    view-projection matrix. This ensures the skybox correctly rotates with the camera.
 * 3. Crucially, the vertex shader outputs a clip-space Z value of 1.0, placing
 *    the skybox exactly at the far clipping plane.
 * 4. When the render pipeline uses a `less-equal` depth comparison, this
 *    technique guarantees that the skybox is only drawn on pixels where no
 *    closer scene geometry exists, effectively making it an efficient background
 *    fill.
 * 5. The fragment shader simply samples the skybox cubemap texture using the
 *    calculated view direction.
 */
export class SkyboxPass implements RenderPass {
  /**
   * Executes the skybox rendering pass.
   *
   * @remarks
   * This method retrieves the skybox material from the `RenderContext`. If one
   * exists, it sets up the appropriate render pipeline and issues a single
   * draw call to render the skybox into the provided render pass encoder.
   *
   * @param context The immutable render context for the current frame.
   * @param passEncoder The `GPURenderPassEncoder` for the main scene pass,
   *   into which the skybox will be drawn.
   */
  public execute(
    context: RenderContext,
    passEncoder: GPURenderPassEncoder,
  ): void {
    const skyboxMaterial = context.sceneData.skyboxMaterial;
    if (!skyboxMaterial) {
      return;
    }

    const pipeline = skyboxMaterial.material.getPipeline(
      [],
      Renderer.INSTANCE_DATA_LAYOUT,
      context.frameBindGroupLayout,
      context.canvasFormat,
      context.depthFormat,
    );
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(1, skyboxMaterial.bindGroup);
    passEncoder.draw(3, 1, 0, 0);
  }
}

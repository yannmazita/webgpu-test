// src/client/rendering/passes/shadowPass.ts
import { ShadowSubsystem } from "@/client/rendering/shadow";
import { Renderer } from "@/client/rendering/renderer";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/shared/ecs/components/resources/sunComponent";
import { CameraComponent } from "@/shared/ecs/components/clientOnly/cameraComponent";
import { RenderContext, RenderPass } from "@/client/types/rendering";

/**
 * Manages the generation of the cascaded shadow map (CSM) for the main sun.
 *
 * @remarks
 * This pass is responsible for rendering the scene from the sun's perspective
 * into a depth texture array. It is a depth-only pass and does not produce any
 * color output.
 *
 * The process is executed in a loop, once for each of the four shadow cascades.
 * For each cascade, it configures a render pass targeting a specific layer of
 * the shadow map texture array. The vertex shader (`shadow.wgsl`) then
 * transforms each shadow-casting object's vertices using its model matrix and
 * the unique view-projection matrix for that specific cascade. The GPU's
 * rasterizer then writes the resulting depth values to the shadow map.
 *
 * The resulting depth texture array is later sampled by the main PBR shader
 * to apply shadows to the scene.
 */
export class ShadowPass implements RenderPass {
  private device: GPUDevice;
  private shadowSubsystem: ShadowSubsystem;

  /**
   * @param device The active GPUDevice.
   */
  constructor(device: GPUDevice) {
    this.device = device;
    this.shadowSubsystem = new ShadowSubsystem(this.device);
  }

  /**
   * Initializes the pass and its underlying `ShadowSubsystem`.
   *
   * @remarks
   * This method sets up the necessary GPU resources, including the shadow map
   * texture array, comparison sampler, and the specialized depth-only render
   * pipeline used to draw shadow casters. It must be called before the pass
   * can be executed.
   */
  public async init(): Promise<void> {
    await this.shadowSubsystem.init(
      [
        {
          arrayStride: 12,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
        {
          arrayStride: 12,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
        },
        {
          arrayStride: 8,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }],
        },
        {
          arrayStride: 16,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 3, offset: 0, format: "float32x4" }],
        },
        {
          arrayStride: 8,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 9, offset: 0, format: "float32x2" }],
        },
      ],
      Renderer.INSTANCE_DATA_LAYOUT,
      "depth32float",
    );
  }

  /**
   * Retrieves the underlying `ShadowSubsystem` instance.
   *
   * @remarks
   * This provides access to the shadow map resources (texture view, sampler,
   * and uniform buffer) which are required by the `Renderer` to construct the
   * main frame bind group.
   *
   * @returns The `ShadowSubsystem` managed by this pass.
   */
  public getShadowSubsystem(): ShadowSubsystem {
    return this.shadowSubsystem;
  }

  /**
   * Updates the shadow subsystem's per-frame uniforms, such as the CSM matrices.
   *
   * @remarks
   * This method is called internally by `execute`. It computes the view and
   * projection matrices for each cascade based on the main camera's frustum
   * and the sun's direction.
   *
   * @param camera The main scene camera.
   * @param sun The scene's directional sun component.
   * @param shadowSettings The current shadow quality settings.
   */
  public updatePerFrame(
    camera: CameraComponent,
    sun?: SceneSunComponent,
    shadowSettings?: ShadowSettingsComponent,
  ): void {
    if (sun && sun.enabled && shadowSettings) {
      this.shadowSubsystem.updatePerFrame(camera, sun, shadowSettings);
    } else {
      this.shadowSubsystem.writeDisabled();
    }
  }

  /**
   * Executes the shadow map generation for the frame.
   *
   * @remarks
   * This is the main entry point for the pass. It performs the following steps:
   * 1. Updates the CSM uniforms by calling `updatePerFrame`.
   * 2. Filters the *entire* scene's renderables to find all potential shadow
   *    casters. It does not use the pre-culled visible list, allowing objects
   *    outside the camera's view to cast shadows into it.
   * 3. Records a series of depth-only render passes, one for each cascade,
   *    drawing all shadow casters into the appropriate layer of the shadow map.
   *
   * @param context The immutable render context for the current frame.
   */
  public execute(context: RenderContext): void {
    const { sun, shadowSettings } = context;

    // The pass is responsible for updating its own subsystem's uniforms.
    this.updatePerFrame(context.camera, sun, shadowSettings);

    if (!sun || !sun.enabled || !sun.castsShadows || !shadowSettings) {
      return;
    }

    // The pass filters its own data from the full scene list.
    // This allows objects outside the camera view to cast shadows.
    const shadowCasters = context.sceneData.renderables.filter(
      (r) => r.castShadows !== false && !r.material.material.isTransparent,
    );

    if (shadowCasters.length === 0) {
      return;
    }

    // The instance data is already on the GPU. We just need the offset.
    const instanceByteOffset =
      context.instanceAllocations.shadows.offset *
      Renderer.INSTANCE_BYTE_STRIDE;

    this.shadowSubsystem.recordShadowPass(
      context.commandEncoder,
      shadowSettings.mapSize,
      shadowCasters,
      context.instanceBuffer,
      instanceByteOffset,
    );
  }
}

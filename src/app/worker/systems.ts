// src/app/worker/systems.ts
import { state } from "@/app/worker/state";
import { SkyboxComponent } from "@/core/ecs/components/skyboxComponent";
import { IBLComponent } from "@/core/ecs/components/iblComponent";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";

/**
 * Handles canvas resize events.
 *
 * @remarks
 * Updates the renderer's viewport dimensions and camera's aspect ratio
 * to match the new canvas size. Stores dimensions for raycast calculations.
 *
 * @param cssWidth - New canvas width in CSS pixels
 * @param cssHeight - New canvas height in CSS pixels
 * @param devicePixelRatio - Device pixel ratio for high-DPI displays
 */
export function handleResize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): void {
  // Store for raycast calculations
  state.lastViewportWidth = cssWidth;
  state.lastViewportHeight = cssHeight;

  // Update camera projection
  const cam =
    state.cameraEntity !== -1
      ? state.world!.getComponent(state.cameraEntity, CameraComponent)
      : undefined;

  if (cam && state.renderer) {
    state.renderer.requestResize(cssWidth, cssHeight, devicePixelRatio, cam);
  } else {
    console.warn("[Worker] Resize skipped: camera or renderer not ready");
  }
}

/**
 * Handles tone mapping toggle requests.
 *
 * @remarks
 * Enables or disables post-processing tone mapping based on the flag.
 *
 * @param enabled - Whether tone mapping should be enabled
 */
export function handleToneMappingChange(enabled: boolean): void {
  if (state.renderer) {
    state.renderer.setToneMappingEnabled(!!enabled);
  }
}

/**
 * Handles environment map changes.
 *
 * @remarks
 * Loads a new HDR environment map and updates the global IBL and skybox
 * resources. Replaces existing environment components in the world.
 *
 * @param url - URL of the HDR environment map to load
 * @param size - Desired resolution for the environment cubemap
 */
export async function handleEnvironmentChange(
  url: string,
  size: number,
): Promise<void> {
  if (!state.resourceManager || !state.world) return;

  try {
    const env = await state.resourceManager.createEnvironmentMap(
      String(url),
      Math.max(16, Math.min(4096, Number(size) | 0)),
    );

    // Replace global resources
    state.world.removeResource(SkyboxComponent);
    state.world.addResource(new SkyboxComponent(env.skyboxMaterial));
    state.world.removeResource(IBLComponent);
    state.world.addResource(env.iblComponent);

    console.log("[Worker] Environment updated:", url, "size=", size);
  } catch (e) {
    console.error("[Worker] Failed to update environment:", e);
  }
}

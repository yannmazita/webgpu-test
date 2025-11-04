// src/app/worker/systems.ts
import { state } from "@/app/worker/state";
import { IBLResourceComponent } from "@/core/ecs/components/resources/resourceComponents";
import { ResourceHandle, ResourceType } from "@/core/resources/resourceHandle";
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
 * Handles environment map changes by updating the IBL resource component.
 *
 * @remarks
 * This function finds or creates an entity with an `IBLResourceComponent` and
 * updates its properties to match the new request. The `ResourceLoadingSystem`
 * will then detect this change and trigger the asynchronous loading and
 * generation of the new environment map.
 *
 * @param url - URL of the HDR environment map to load.
 * @param size - Desired resolution for the environment cubemap.
 */
export async function handleEnvironmentChange(
  url: string,
  size: number,
): Promise<void> {
  if (!state.world) return;

  try {
    const world = state.world;
    const query = world.query([IBLResourceComponent]);
    const iblEntity =
      query.length > 0 ? query[0] : world.createEntity("ibl_resource");

    // Create a new handle and component to trigger a reload.
    const newHandle = ResourceHandle.create(ResourceType.EnvironmentMap, url);
    const newComponent = new IBLResourceComponent(
      newHandle,
      url,
      Math.max(16, Math.min(4096, Number(size) | 0)),
    );

    // Replace or add the component on the entity.
    world.addComponent(iblEntity, newComponent);

    console.log(
      "[Worker] Environment change requested for:",
      url,
      "size=",
      size,
    );
  } catch (e) {
    console.error("[Worker] Failed to handle environment change request:", e);
  }
}

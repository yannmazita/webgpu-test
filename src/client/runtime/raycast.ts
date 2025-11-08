// src/client/runtime/raycast.ts
import { state } from "@/client/runtime/state";
import { CameraComponent } from "@/shared/ecs/components/cameraComponent";
import { vec3 } from "wgpu-matrix";
import { getPickRay, raycast } from "@/shared/utils/raycast";
import { RaycastResponseMsg, MSG_RAYCAST_RESPONSE } from "@/shared/types/worker";

/**
 * Handles a raycast request from the main thread.
 *
 * @remarks
 * Generates a pick ray from screen coordinates through the camera,
 * performs an ECS raycast against renderable entities, and returns
 * the hit result with entity name.
 *
 * @param x - Screen X coordinate in CSS pixels
 * @param y - Screen Y coordinate in CSS pixels
 */
export function handleRaycastRequest(x: number, y: number): void {
  console.log("[Worker] Received raycast request:", { x, y });

  const cam =
    state.cameraEntity !== -1
      ? state.world!.getComponent(state.cameraEntity, CameraComponent)
      : undefined;

  if (!cam) {
    console.warn("[Worker] Raycast failed: no camera component");
    return;
  }

  // Log camera position for debugging
  const camPos = vec3.fromValues(
    cam.inverseViewMatrix[12],
    cam.inverseViewMatrix[13],
    cam.inverseViewMatrix[14],
  );
  console.log(
    `[Worker] Camera position: ${camPos[0].toFixed(2)}, ${camPos[1].toFixed(2)}, ${camPos[2].toFixed(2)}`,
  );

  // Generate pick ray
  const { origin, direction } = getPickRay(
    { x, y },
    state.lastViewportWidth,
    state.lastViewportHeight,
    cam,
  );
  console.log(
    `[Worker] Generated Ray -> Origin: [${origin[0].toFixed(2)}, ${origin[1].toFixed(2)}, ${origin[2].toFixed(2)}], Direction: [${direction[0].toFixed(2)}, ${direction[1].toFixed(2)}, ${direction[2].toFixed(2)}]`,
  );

  // Perform raycast
  const hit = raycast(state.world!, origin, direction);
  console.log("[Worker] Raycast hit:", hit);

  // Prepare response with entity name
  let responseHit = null;
  if (hit) {
    responseHit = {
      ...hit,
      entityName: state.world!.getEntityName(hit.entity),
    };
  }

  const response: RaycastResponseMsg = {
    type: MSG_RAYCAST_RESPONSE,
    hit: responseHit,
  };
  self.postMessage(response);
}

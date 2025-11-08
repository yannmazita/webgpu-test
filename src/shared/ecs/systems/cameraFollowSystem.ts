// src/shared/ecs/systems/cameraFollowSystem.ts
import { World } from "@/shared/ecs/world";
import { TransformComponent } from "@/shared/ecs/components/transformComponent";
import { CameraFollowComponent } from "@/shared/ecs/components/cameraFollowComponent";
import { PlayerControllerComponent } from "@/shared/ecs/components/playerControllerComponent";
import { quat, vec3 } from "wgpu-matrix";

/**
 * Updates the transform of entities that have a `CameraFollowComponent`.
 *
 * This system ensures that a camera (or any entity) smoothly follows its target.
 * It handles position with an offset and can optionally sync rotation.
 * For an FPS player, it specifically reads the player's pitch and yaw from the
 * `PlayerControllerComponent` to construct the final first-person camera rotation.
 *
 * This system should run after the target's transform has been finalized for the frame
 * (ie after `playerControllerSystem` and `transformSystem`).
 *
 * @param world The ECS world.
 */
export function cameraFollowSystem(world: World): void {
  const query = world.query([TransformComponent, CameraFollowComponent]);

  for (const entity of query) {
    const transform = world.getComponent(entity, TransformComponent);
    const follow = world.getComponent(entity, CameraFollowComponent);

    if (!transform || !follow) continue;

    const targetTransform = world.getComponent(
      follow.target,
      TransformComponent,
    );
    if (!targetTransform) continue;

    // --- Position ---
    const targetPosition = vec3.clone(targetTransform.position);
    const finalPosition = vec3.add(targetPosition, follow.positionOffset);
    transform.setPosition(finalPosition);

    // --- Rotation ---
    // Special case for following a player character to create an FPS view.
    const playerController = world.getComponent(
      follow.target,
      PlayerControllerComponent,
    );
    if (playerController) {
      // FPS camera: use the controller's pitch and yaw directly.
      const cameraRotation = quat.fromEuler(
        playerController.pitch,
        playerController.yaw,
        0,
        "yxz",
      );
      transform.setRotation(cameraRotation);
    } else if (follow.followRotation) {
      // Generic case: just copy the target's rotation.
      transform.setRotation(targetTransform.rotation);
    }
    // If neither case is met, the camera's rotation is not modified.
  }
}

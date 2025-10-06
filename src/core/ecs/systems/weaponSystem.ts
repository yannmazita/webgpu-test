// src/core/ecs/systems/weaponSystem.ts
import { World } from "@/core/ecs/world";
import { IActionController } from "@/core/input/action";
import { PhysicsContext } from "@/core/physicsState";
import { PlayerControllerComponent } from "../components/playerControllerComponent";
import { WeaponComponent } from "../components/weaponComponent";
import { MainCameraTagComponent } from "../components/tagComponents";
import { CameraComponent } from "../components/cameraComponent";
import { TransformComponent } from "../components/transformComponent";
import { vec3 } from "wgpu-matrix";

// Reusable temporaries
const rayOrigin = vec3.create();
const rayDirection = vec3.create();

/**
 * Handles the logic for firing weapons.
 *
 * This system queries for the player entity, checks for the "fire" input,
 * manages the weapon's cooldown, and will eventually send raycast commands
 * to the physics worker to detect hits.
 *
 * @param world The ECS world.
 * @param actions The input action controller.
 * @param physCtx The physics context for sending commands to the physics worker.
 * @param deltaTime The time elapsed since the last frame in seconds.
 */
export function weaponSystem(
  world: World,
  actions: IActionController,
  physCtx: PhysicsContext,
  deltaTime: number,
): void {
  const query = world.query([PlayerControllerComponent, WeaponComponent]);
  if (query.length === 0) {
    return;
  }

  const playerEntity = query[0];
  const weapon = world.getComponent(playerEntity, WeaponComponent);
  if (!weapon) {
    return;
  }

  // 1. Update cooldown timer
  if (weapon.cooldown > 0) {
    weapon.cooldown -= deltaTime;
  }

  // 2. Check for fire input
  if (actions.isPressed("fire") && weapon.cooldown <= 0) {
    // 3. Reset cooldown
    weapon.cooldown = 1.0 / weapon.fireRate;

    // 4. Get camera transform for raycast origin and direction
    const cameraQuery = world.query([MainCameraTagComponent, CameraComponent, TransformComponent]);
    if (cameraQuery.length === 0) {
      return;
    }
    const cameraEntity = cameraQuery[0];
    const cameraTransform = world.getComponent(cameraEntity, TransformComponent);
    if (!cameraTransform) {
      return;
    }

    // The ray originates from the camera's world position
    vec3.set(
        cameraTransform.worldMatrix[12],
        cameraTransform.worldMatrix[13],
        cameraTransform.worldMatrix[14],
        rayOrigin
    );

    // The ray direction is the camera's forward vector (-Z axis of its transform)
    vec3.set(
        -cameraTransform.worldMatrix[8],
        -cameraTransform.worldMatrix[9],
        -cameraTransform.worldMatrix[10],
        rayDirection
    );
    vec3.normalize(rayDirection, rayDirection);


    // TODO: Send raycast command to physics worker
    console.log(
      `Firing weapon! Ray from ${rayOrigin.join(", ")} in direction ${rayDirection.join(", ")}`
    );

    // Example of what the command would look like:
    /*
    tryEnqueueCommand(physCtx, CMD_RAYCAST_WEAPON, playerEntity, [
      rayOrigin[0], rayOrigin[1], rayOrigin[2],
      rayDirection[0], rayDirection[1], rayDirection[2],
      weapon.range,
    ]);
    */
  }

  // TODO: Read raycast hit results from the physics state buffer
  // and apply damage or create visual effects.
}

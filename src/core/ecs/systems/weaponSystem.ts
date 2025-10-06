// src/core/ecs/systems/weaponSystem.ts
import { World } from "@/core/ecs/world";
import { IActionController } from "@/core/input/action";
import {
  PhysicsContext,
  tryEnqueueCommand,
} from "@/core/physicsState";
import {
  CMD_WEAPON_RAYCAST,
  RAYCAST_RESULTS_GEN_OFFSET,
  RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET,
} from "@/core/sharedPhysicsLayout";
import { CameraComponent } from "../components/cameraComponent";
import { HealthComponent } from "../components/healthComponent";
import { MainCameraTagComponent } from "../components/tagComponents";
import { TransformComponent } from "../components/transformComponent";
import { WeaponComponent } from "../components/weaponComponent";
import { PlayerControllerComponent } from "../components/playerControllerComponent";
import { vec3 } from "wgpu-matrix";

// Reusable temporaries
const rayOrigin = vec3.create();
const rayDirection = vec3.create();

let lastRaycastGen = 0;

/**
 * Handles weapon firing logic, including sending raycast commands to the physics
 * worker and processing hit results.
 *
 * @param world The ECS world.
 * @param actions The input action controller.
 * @param physCtx The context for the physics command buffer.
 * @param raycastResultsCtx The context for the raycast results buffer.
 * @param deltaTime The time elapsed since the last frame in seconds.
 */
export function weaponSystem(
  world: World,
  actions: IActionController,
  physCtx: PhysicsContext,
  raycastResultsCtx: { i32: Int32Array; f32: Float32Array },
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
    weapon.cooldown = 1.0 / weapon.fireRate;

    const cameraQuery = world.query([
      MainCameraTagComponent,
      CameraComponent,
      TransformComponent,
    ]);
    if (cameraQuery.length > 0) {
      const cameraTransform = world.getComponent(
        cameraQuery[0],
        TransformComponent,
      );
      if (cameraTransform) {
        // Ray originates from the camera's world position
        vec3.set(
          cameraTransform.worldMatrix[12],
          cameraTransform.worldMatrix[13],
          cameraTransform.worldMatrix[14],
          rayOrigin,
        );

        // Ray direction is the camera's forward vector (-Z axis)
        vec3.set(
          -cameraTransform.worldMatrix[8],
          -cameraTransform.worldMatrix[9],
          -cameraTransform.worldMatrix[10],
          rayDirection,
        );
        vec3.normalize(rayDirection, rayDirection);

        // Enqueue raycast command for the physics worker
        tryEnqueueCommand(physCtx, CMD_WEAPON_RAYCAST, playerEntity, [
          rayOrigin[0],
          rayOrigin[1],
          rayOrigin[2],
          rayDirection[0],
          rayDirection[1],
          rayDirection[2],
          weapon.range,
        ]);
      }
    }
  }

  // 3. Check for raycast results from the physics worker
  const currentGen = Atomics.load(
    raycastResultsCtx.i32,
    RAYCAST_RESULTS_GEN_OFFSET >> 2,
  );
  if (currentGen !== lastRaycastGen) {
    lastRaycastGen = currentGen;

    const hitEntityId = Atomics.load(
      raycastResultsCtx.i32,
      RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET >> 2,
    );

    if (hitEntityId !== 0) {
      // The physics worker returns the physId, which is the same as the entity ID
      const hitEntity = hitEntityId;
      const health = world.getComponent(hitEntity, HealthComponent);
      if (health) {
        health.currentHealth -= weapon.damage;
        console.log(
          `[WeaponSystem] Hit entity ${hitEntity}! Health remaining: ${health.currentHealth}`,
        );
        if (health.currentHealth <= 0) {
          // For now, just log. Later, we could destroy the entity.
          console.log(`[WeaponSystem] Entity ${hitEntity} has been defeated!`);
        }
      }
    }
  }
}

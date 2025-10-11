// src/core/ecs/systems/weaponSystem.ts

import { World } from "@/core/ecs/world";
import { IActionController } from "@/core/input/action";
import { PhysicsContext, tryEnqueueCommand } from "@/core/physicsState";
import {
  CMD_WEAPON_RAYCAST,
  RAYCAST_RESULTS_GEN_OFFSET,
  RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET,
} from "@/core/sharedPhysicsLayout";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { HealthComponent } from "@/core/ecs/components/healthComponent";
import { MainCameraTagComponent } from "@/core/ecs/components/tagComponents";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { WeaponComponent } from "@/core/ecs/components/weaponComponent";
import { PlayerControllerComponent } from "@/core/ecs/components/playerControllerComponent";
import { vec3 } from "wgpu-matrix";
import { DamageSystem } from "./damageSystem";
import { ProjectileComponent } from "@/core/ecs/components/projectileComponent";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
} from "@/core/ecs/components/physicsComponents";
import { MeshRendererComponent } from "@/core/ecs/components/meshRendererComponent";
import { ResourceManager } from "@/core/resources/resourceManager";

// Reusable temporaries
const rayOrigin = vec3.create();
const rayDirection = vec3.create();
const projectileVelocity = vec3.create();

let lastRaycastGen = 0;

/**
 * Handles weapon firing logic.
 *
 * Depending on the WeaponComponent's properties, this system will either:
 * 1.  (Hitscan) Enqueue a raycast command to the physics worker.
 * 2.  (Projectile) Spawn a new projectile entity with an initial velocity.
 *
 * It also processes hit results from hitscan weapons. Projectile hits are
 * handled by the CollisionEventSystem.
 *
 * @param world The ECS world.
 * @param resourceManager The manager for loading and creating assets.
 * @param actions The input action controller.
 * @param physCtx The context for the physics command buffer.
 * @param raycastResultsCtx The context for the raycast results buffer.
 * @param damageSystem The system responsible for processing damage events.
 * @param deltaTime The time elapsed since the last frame in seconds.
 */
export function weaponSystem(
  world: World,
  resourceManager: ResourceManager,
  actions: IActionController,
  physCtx: PhysicsContext,
  raycastResultsCtx: { i32: Int32Array; f32: Float32Array },
  damageSystem: DamageSystem,
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
    if (cameraQuery.length === 0) return;

    const cameraTransform = world.getComponent(
      cameraQuery[0],
      TransformComponent,
    );
    if (!cameraTransform) return;

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

    if (weapon.isHitscan) {
      // --- Hitscan Logic ---
      tryEnqueueCommand(physCtx, CMD_WEAPON_RAYCAST, playerEntity, [
        rayOrigin[0],
        rayOrigin[1],
        rayOrigin[2],
        rayDirection[0],
        rayDirection[1],
        rayDirection[2],
        weapon.range,
      ]);
    } else {
      // --- Projectile Spawning Logic ---
      if (!weapon.projectileMeshHandle || !weapon.projectileMaterialHandle) {
        console.warn(
          "[WeaponSystem] Attempted to fire projectile weapon without projectile mesh/material handles.",
        );
        return;
      }

      // Synchronously get pre-loaded resources. This is fast and non-blocking
      // because the assets were loaded during the scene setup phase.
      const mesh = resourceManager.getMeshByHandleSync(
        weapon.projectileMeshHandle,
      );
      const material = resourceManager.getMaterialInstanceByHandleSync(
        weapon.projectileMaterialHandle,
      );

      if (!mesh || !material) {
        console.error(
          `[WeaponSystem] Projectile resources not pre-loaded for handles: ${weapon.projectileMeshHandle}, ${weapon.projectileMaterialHandle}. Firing aborted. Ensure assets are loaded in scene file.`,
        );
        return;
      }

      const projectileEntity = world.createEntity();

      // Transform: Start at camera position, move slightly forward to avoid self-collision
      const startPosition = vec3.add(rayOrigin, vec3.scale(rayDirection, 1.0));
      const transform = new TransformComponent();
      transform.setPosition(startPosition);
      world.addComponent(projectileEntity, transform);

      // Visuals
      world.addComponent(
        projectileEntity,
        new MeshRendererComponent(mesh, material),
      );

      // Gameplay
      world.addComponent(
        projectileEntity,
        new ProjectileComponent(
          playerEntity,
          weapon.damage,
          weapon.projectileLifetime,
        ),
      );

      // Physics
      vec3.scale(rayDirection, weapon.projectileSpeed, projectileVelocity);
      world.addComponent(
        projectileEntity,
        new PhysicsBodyComponent("dynamic", false, projectileVelocity),
      );
      const collider = new PhysicsColliderComponent();
      collider.setSphere(weapon.projectileRadius);
      world.addComponent(projectileEntity, collider);
    }
  }

  // 3. Check for raycast results from the physics worker (Hitscan only)
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
      const hitEntity = hitEntityId;
      if (world.hasComponent(hitEntity, HealthComponent)) {
        damageSystem.enqueueDamageEvent({
          target: hitEntity,
          amount: weapon.damage,
          source: playerEntity,
        });
      }
    }
  }
}

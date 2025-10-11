// src/core/ecs/systems/weaponSystem.ts

import { World } from "@/core/ecs/world";
import { PhysicsContext, tryEnqueueCommand } from "@/core/physicsState";
import {
  CMD_WEAPON_RAYCAST,
  RAYCAST_RESULTS_GEN_OFFSET,
  RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET,
} from "@/core/sharedPhysicsLayout";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { HealthComponent } from "@/core/ecs/components/healthComponent";
import {
  MainCameraTagComponent,
  WantsToFireTagComponent,
} from "@/core/ecs/components/tagComponents";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { WeaponComponent } from "@/core/ecs/components/weaponComponent";
import { vec3 } from "wgpu-matrix";
import { DamageSystem } from "./damageSystem";
import { ProjectileComponent } from "@/core/ecs/components/projectileComponent";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
} from "@/core/ecs/components/physicsComponents";
import { MeshRendererComponent } from "@/core/ecs/components/meshRendererComponent";
import { ResourceManager } from "@/core/resources/resourceManager";
import { LifetimeComponent } from "../components/lifetimeComponent";

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
 * @param physCtx The context for the physics command buffer.
 * @param raycastResultsCtx The context for the raycast results buffer.
 * @param damageSystem The system responsible for processing damage events.
 * @param deltaTime The time elapsed since the last frame in seconds.
 */
export function weaponSystem(
  world: World,
  resourceManager: ResourceManager,
  physCtx: PhysicsContext,
  raycastResultsCtx: { i32: Int32Array; f32: Float32Array },
  damageSystem: DamageSystem,
  deltaTime: number,
): void {
  // 1. Update cooldown timers for all weapons
  const allWeaponsQuery = world.query([WeaponComponent]);
  for (const entity of allWeaponsQuery) {
    const weapon = world.getComponent(entity, WeaponComponent);
    if (weapon && weapon.cooldown > 0) {
      weapon.cooldown -= deltaTime;
    }
  }

  // 2. Query for entities that want to fire
  const firingQuery = world.query([WeaponComponent, WantsToFireTagComponent]);
  if (firingQuery.length === 0) {
    return;
  }

  // Find the main camera once for all firing entities that might need it
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

  for (const firingEntity of firingQuery) {
    const weapon = world.getComponent(firingEntity, WeaponComponent);
    if (!weapon) continue;

    // Check cooldown
    if (weapon.cooldown <= 0) {
      weapon.cooldown = 1.0 / weapon.fireRate;

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
        tryEnqueueCommand(physCtx, CMD_WEAPON_RAYCAST, firingEntity, [
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
          continue; // Use continue to process other firing entities
        }

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
          continue;
        }

        const projectileEntity = world.createEntity();

        const startPosition = vec3.add(
          rayOrigin,
          vec3.scale(rayDirection, 1.0),
        );
        const transform = new TransformComponent();
        transform.setPosition(startPosition);
        world.addComponent(projectileEntity, transform);

        world.addComponent(
          projectileEntity,
          new MeshRendererComponent(mesh, material),
        );

        // Gameplay
        world.addComponent(
          projectileEntity,
          new ProjectileComponent(firingEntity, weapon.damage),
        );

        // Lifetime
        world.addComponent(
          projectileEntity,
          new LifetimeComponent(weapon.projectileLifetime),
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

    // IMPORTANT: Remove the intent tag after processing.
    world.removeComponent(firingEntity, WantsToFireTagComponent);
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
        // HACK: Assuming the first firing entity is the source. This is a limitation
        // of the current raycast result buffer, which doesn't return the source ID.
        // Todo: revision needed for multiplayer/AI.
        const sourceEntity = firingQuery.length > 0 ? firingQuery[0] : 0;
        const weapon = world.getComponent(sourceEntity, WeaponComponent);
        if (weapon) {
          damageSystem.enqueueDamageEvent({
            target: hitEntity,
            amount: weapon.damage,
            source: sourceEntity,
          });
        }
      }
    }
  }
}

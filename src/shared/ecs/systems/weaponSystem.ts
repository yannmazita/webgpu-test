// src/shared/ecs/systems/weaponSystem.ts
import { World } from "@/shared/ecs/world";
import { PhysicsContext, tryEnqueueCommand } from "@/shared/state/physicsState";
import {
  CMD_WEAPON_RAYCAST,
  RAYCAST_RESULTS_GEN_OFFSET,
  RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET,
  RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET,
} from "@/shared/state/sharedPhysicsLayout";
import { CameraComponent } from "@/shared/ecs/components/cameraComponent";
import { MainCameraTagComponent } from "@/shared/ecs/components/tagComponents";
import { TransformComponent } from "@/shared/ecs/components/transformComponent";
import { WeaponComponent } from "@/shared/ecs/components/weaponComponent";
import { vec3 } from "wgpu-matrix";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
} from "@/shared/ecs/components/physicsComponents";
import { MeshRendererComponent } from "@/shared/ecs/components/render/meshRendererComponent";
import { LifetimeComponent } from "@/shared/ecs/components/lifetimeComponent";
import { EventManager } from "@/shared/ecs/events/eventManager";
import { GameEvent } from "@/shared/ecs/events/gameEvent";
import { ProjectileComponent } from "@/shared/ecs/components/projectileComponent";
import { ResourceCacheComponent } from "../components/resources/resourceCacheComponent";

// Reusable temporaries
const rayOrigin = vec3.create();
const rayDirection = vec3.create();
const projectileVelocity = vec3.create();

/**
 * Handles weapon firing logic, cooldowns, and ammo management.
 * @remarks
 * This system is responsible for:
 * 1. Managing weapon cooldowns and ammo
 * 2. Subscribing to `FireWeaponEvent` and executing firing logic
 * 3. Publishing combat events for weapon actions
 * 4. Processing hitscan results and publishing hit events
 *
 * It consumes pre-loaded projectile assets from the global `ResourceCacheComponent`.
 */
export class WeaponSystem {
  private lastRaycastGen = 0;

  /**
   * @param world - The ECS world.
   * @param physCtx - The shared physics context.
   * @param raycastResultsCtx - The shared buffer for raycast results.
   * @param eventManager - The global event manager.
   */
  constructor(
    private world: World,
    private physCtx: PhysicsContext,
    private raycastResultsCtx: { i32: Int32Array; f32: Float32Array },
    private eventManager: EventManager,
  ) {
    this.eventManager.subscribe("fire-weapon", this.onFireWeapon.bind(this));
  }

  private onFireWeapon(event: GameEvent): void {
    if (event.type !== "fire-weapon") return;

    const firingEntity = event.payload.shooter;
    const weapon = this.world.getComponent(firingEntity, WeaponComponent);
    if (!weapon) return;

    // Check cooldown
    if (weapon.cooldown > 0) {
      return;
    }

    // Check ammo
    if (weapon.usesAmmo && weapon.currentMagazineAmmo <= 0) {
      this.eventManager.publish({
        type: "weapon-empty",
        payload: { entity: firingEntity, weaponType: weapon.weaponType },
      });
      return;
    }

    // Set cooldown
    weapon.cooldown = 1.0 / weapon.fireRate;

    // Consume ammo
    if (weapon.usesAmmo) {
      weapon.currentMagazineAmmo--;
      this.eventManager.publish({
        type: "ammo-changed",
        payload: {
          entity: firingEntity,
          weaponType: weapon.weaponType,
          magazineAmmo: weapon.currentMagazineAmmo,
          reserveAmmo: weapon.reserveAmmo,
        },
      });
    }

    const cameraQuery = this.world.query([
      MainCameraTagComponent,
      CameraComponent,
      TransformComponent,
    ]);
    if (cameraQuery.length === 0) return;
    const cameraTransform = this.world.getComponent(
      cameraQuery[0],
      TransformComponent,
    );
    if (!cameraTransform) return;

    vec3.set(
      cameraTransform.worldMatrix[12],
      cameraTransform.worldMatrix[13],
      cameraTransform.worldMatrix[14],
      rayOrigin,
    );
    vec3.set(
      -cameraTransform.worldMatrix[8],
      -cameraTransform.worldMatrix[9],
      -cameraTransform.worldMatrix[10],
      rayDirection,
    );
    vec3.normalize(rayDirection, rayDirection);

    if (weapon.isHitscan) {
      // --- Hitscan Logic ---
      this.eventManager.publish({
        type: "hitscan-fired",
        payload: {
          shooter: firingEntity,
          weaponType: weapon.weaponType,
          rayOrigin: vec3.clone(rayOrigin),
          rayDirection: vec3.clone(rayDirection),
          range: weapon.range,
        },
      });
      tryEnqueueCommand(this.physCtx, CMD_WEAPON_RAYCAST, firingEntity, [
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

      // Get resources from the global cache
      const cache = this.world.getResource(ResourceCacheComponent);
      if (!cache) {
        console.error(
          "[WeaponSystem] ResourceCacheComponent not found in world. Firing aborted.",
        );
        return;
      }
      const mesh = cache.getMesh(weapon.projectileMeshHandle.key);
      const material = cache.getMaterial(weapon.projectileMaterialHandle.key);

      if (!mesh || !material) {
        console.error(
          `[WeaponSystem] Projectile resources not pre-loaded for handles: ${weapon.projectileMeshHandle.key}, ${weapon.projectileMaterialHandle.key}. Firing aborted.`,
        );
        return;
      }

      const projectileEntity = this.world.createEntity();
      const startPosition = vec3.add(rayOrigin, vec3.scale(rayDirection, 1.0));
      const transform = new TransformComponent();
      transform.setPosition(startPosition);
      this.world.addComponent(projectileEntity, transform);

      // Use the handles directly in the MeshRendererComponent
      this.world.addComponent(
        projectileEntity,
        new MeshRendererComponent(
          weapon.projectileMeshHandle,
          weapon.projectileMaterialHandle,
        ),
      );

      this.world.addComponent(
        projectileEntity,
        new ProjectileComponent(firingEntity, weapon.damage),
      );
      this.world.addComponent(
        projectileEntity,
        new LifetimeComponent(weapon.projectileLifetime),
      );

      vec3.scale(rayDirection, weapon.projectileSpeed, projectileVelocity);
      this.world.addComponent(
        projectileEntity,
        new PhysicsBodyComponent("dynamic", false, projectileVelocity),
      );
      const collider = new PhysicsColliderComponent();
      collider.setSphere(weapon.projectileRadius);
      this.world.addComponent(projectileEntity, collider);

      this.eventManager.publish({
        type: "projectile-spawned",
        payload: {
          projectile: projectileEntity,
          owner: firingEntity,
          spawnPosition: vec3.clone(startPosition),
          velocity: vec3.clone(projectileVelocity),
          weaponType: weapon.weaponType,
        },
      });
    }
  }

  public update(deltaTime: number): void {
    // 1. Update cooldown timers for all weapons
    const allWeaponsQuery = this.world.query([WeaponComponent]);
    for (const entity of allWeaponsQuery) {
      const weapon = this.world.getComponent(entity, WeaponComponent);
      if (weapon && weapon.cooldown > 0) {
        weapon.cooldown -= deltaTime;
      }

      // Handle reload timer
      if (weapon && weapon.isReloading && weapon.reloadTimer > 0) {
        weapon.reloadTimer -= deltaTime;
        if (weapon.reloadTimer <= 0) {
          // Reload complete
          weapon.isReloading = false;
          const ammoToLoad = Math.min(
            weapon.magazineSize - weapon.currentMagazineAmmo,
            weapon.reserveAmmo,
          );
          weapon.currentMagazineAmmo += ammoToLoad;
          weapon.reserveAmmo -= ammoToLoad;

          // Publish reload completed event
          this.eventManager.publish({
            type: "weapon-reload-completed",
            payload: {
              entity,
              weaponType: weapon.weaponType,
              newAmmo: weapon.currentMagazineAmmo,
            },
          });

          // Publish ammo changed event
          this.eventManager.publish({
            type: "ammo-changed",
            payload: {
              entity,
              weaponType: weapon.weaponType,
              magazineAmmo: weapon.currentMagazineAmmo,
              reserveAmmo: weapon.reserveAmmo,
            },
          });
        }
      }
    }

    // 2. Check for raycast results from the physics worker (Hitscan only)
    const currentGen = Atomics.load(
      this.raycastResultsCtx.i32,
      RAYCAST_RESULTS_GEN_OFFSET >> 2,
    );
    if (currentGen !== this.lastRaycastGen) {
      this.lastRaycastGen = currentGen;

      const sourceEntityId = Atomics.load(
        this.raycastResultsCtx.i32,
        RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET >> 2,
      );
      const hitEntityId = Atomics.load(
        this.raycastResultsCtx.i32,
        RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET >> 2,
      );

      if (hitEntityId !== 0 && sourceEntityId !== 0) {
        const weapon = this.world.getComponent(sourceEntityId, WeaponComponent);
        if (weapon) {
          // Read hit position from raycast results
          const hitPosX = this.raycastResultsCtx.f32[8]; // Offset in f32 array
          const hitPosY = this.raycastResultsCtx.f32[9];
          const hitPosZ = this.raycastResultsCtx.f32[10];
          const hitNormalX = this.raycastResultsCtx.f32[11];
          const hitNormalY = this.raycastResultsCtx.f32[12];
          const hitNormalZ = this.raycastResultsCtx.f32[13];
          const distance = this.raycastResultsCtx.f32[14];

          // Publish hitscan hit event with damage
          this.eventManager.publish({
            type: "hitscan-hit",
            payload: {
              shooter: sourceEntityId,
              target: hitEntityId,
              weaponType: weapon.weaponType,
              hitPosition: vec3.create(hitPosX, hitPosY, hitPosZ),
              hitNormal: vec3.create(hitNormalX, hitNormalY, hitNormalZ),
              distance: distance,
              dealtDamage: false, // Will be updated by DamageSystem
            },
          });
        }
      }
    }
  }
}

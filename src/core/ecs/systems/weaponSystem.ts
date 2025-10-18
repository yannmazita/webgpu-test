// src/core/ecs/systems/weaponSystem.ts
import { World } from "@/core/ecs/world";
import { PhysicsContext, tryEnqueueCommand } from "@/core/physicsState";
import {
  CMD_WEAPON_RAYCAST,
  RAYCAST_RESULTS_GEN_OFFSET,
  RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET,
  RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET,
} from "@/core/sharedPhysicsLayout";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { MainCameraTagComponent } from "@/core/ecs/components/tagComponents";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { WeaponComponent } from "@/core/ecs/components/weaponComponent";
import { vec3 } from "wgpu-matrix";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
} from "@/core/ecs/components/physicsComponents";
import { MeshRendererComponent } from "@/core/ecs/components/meshRendererComponent";
import { ResourceManager } from "@/core/resources/resourceManager";
import { LifetimeComponent } from "@/core/ecs/components/lifetimeComponent";
import { EventManager } from "@/core/ecs/events/eventManager";
import { GameEvent } from "@/core/ecs/events/gameEvent";
import { ProjectileComponent } from "@/core/ecs/components/projectileComponent";

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
 * Projectile impacts are handled by ProjectileSystem.
 */
export class WeaponSystem {
  private lastRaycastGen = 0;

  constructor(
    private world: World,
    private resourceManager: ResourceManager,
    private physCtx: PhysicsContext,
    private raycastResultsCtx: { i32: Int32Array; f32: Float32Array },
    private eventManager: EventManager,
  ) {
    this.eventManager.subscribe("fire-weapon", this.onFireWeapon.bind(this));
  }

  /**
   * The listener function for `FireWeaponEvent`.
   */
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
      // Publish weapon empty event
      this.eventManager.publish({
        type: "weapon-empty",
        payload: {
          entity: firingEntity,
          weaponType: weapon.weaponType,
        },
      });
      return;
    }

    // Set cooldown
    weapon.cooldown = 1.0 / weapon.fireRate;

    // Consume ammo
    if (weapon.usesAmmo) {
      weapon.currentMagazineAmmo--;

      // Publish ammo changed event
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

    // Find the main camera for ray origin and direction
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
      // Publish hitscan fired event
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
      console.log(
        `[WeaponSystem] Firing projectile weapon for entity ${firingEntity}`,
      );

      if (!weapon.projectileMeshHandle || !weapon.projectileMaterialHandle) {
        console.warn(
          "[WeaponSystem] Attempted to fire projectile weapon without projectile mesh/material handles.",
        );
        return;
      }

      const mesh = this.resourceManager.getMeshByHandleSync(
        weapon.projectileMeshHandle,
      );
      const material = this.resourceManager.getMaterialInstanceByHandleSync(
        weapon.projectileMaterialHandle,
      );

      if (!mesh || !material) {
        console.error(
          `[WeaponSystem] Projectile resources not pre-loaded for handles: ${weapon.projectileMeshHandle}, ${weapon.projectileMaterialHandle}. Firing aborted.`,
        );
        return;
      }

      const projectileEntity = this.world.createEntity();
      console.log(
        `[WeaponSystem] Created projectile entity ${projectileEntity}`,
      );

      const startPosition = vec3.add(rayOrigin, vec3.scale(rayDirection, 1.0));
      const transform = new TransformComponent();
      transform.setPosition(startPosition);
      this.world.addComponent(projectileEntity, transform);

      this.world.addComponent(
        projectileEntity,
        new MeshRendererComponent(mesh, material),
      );

      // Gameplay - pass weapon damage to projectile
      console.log(
        `[WeaponSystem] Adding ProjectileComponent with damage ${weapon.damage}`,
      );
      this.world.addComponent(
        projectileEntity,
        new ProjectileComponent(firingEntity, weapon.damage),
      );

      // Lifetime
      this.world.addComponent(
        projectileEntity,
        new LifetimeComponent(weapon.projectileLifetime),
      );

      // Physics
      vec3.scale(rayDirection, weapon.projectileSpeed, projectileVelocity);
      this.world.addComponent(
        projectileEntity,
        new PhysicsBodyComponent("dynamic", false, projectileVelocity),
      );
      const collider = new PhysicsColliderComponent();
      collider.setSphere(weapon.projectileRadius);
      this.world.addComponent(projectileEntity, collider);

      // Publish projectile spawned event
      const spawnedEvent = {
        type: "projectile-spawned" as const,
        payload: {
          projectile: projectileEntity,
          owner: firingEntity,
          spawnPosition: vec3.clone(startPosition),
          velocity: vec3.clone(projectileVelocity),
          weaponType: weapon.weaponType,
        },
      };
      console.log(
        `[WeaponSystem] Publishing projectile-spawned event:`,
        spawnedEvent.payload,
      );
      this.eventManager.publish(spawnedEvent);
    }
  }

  /**
   * Updates the system every frame.
   */
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

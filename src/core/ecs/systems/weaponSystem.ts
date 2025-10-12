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
import { HealthComponent } from "@/core/ecs/components/healthComponent";
import { MainCameraTagComponent } from "@/core/ecs/components/tagComponents";
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
import { EventManager, GameEvent } from "../events";

// Reusable temporaries
const rayOrigin = vec3.create();
const rayDirection = vec3.create();
const projectileVelocity = vec3.create();

/**
 * Handles weapon firing logic and cooldowns.
 * @remarks
 * This system is responsible for two main tasks:
 * 1.  Decrementing the cooldown timer for all weapons each frame.
 * 2.  Subscribing to `FireWeaponEvent` and executing the firing logic
 *     (hitscan or projectile) for the shooter entity when an event is received.
 *
 * It also processes hit results from hitscan weapons. Projectile hits are
 * handled by the CollisionEventSystem.
 */
export class WeaponSystem {
  private lastRaycastGen = 0;

  /**
   * @param world The ECS world.
   * @param resourceManager The manager for loading and creating assets.
   * @param physCtx The context for the physics command buffer.
   * @param raycastResultsCtx The context for the raycast results buffer.
   * @param damageSystem The system responsible for processing damage events.
   * @param eventManager The global event manager.
   */
  constructor(
    private world: World,
    private resourceManager: ResourceManager,
    private physCtx: PhysicsContext,
    private raycastResultsCtx: { i32: Int32Array; f32: Float32Array },
    private damageSystem: DamageSystem,
    private eventManager: EventManager,
  ) {
    this.eventManager.subscribe("fire-weapon", this.onFireWeapon.bind(this));
  }

  /**
   * The listener function for `FireWeaponEvent`.
   * @param event The game event containing the fire weapon payload.
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
    weapon.cooldown = 1.0 / weapon.fireRate;

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

      const mesh = this.resourceManager.getMeshByHandleSync(
        weapon.projectileMeshHandle,
      );
      const material = this.resourceManager.getMaterialInstanceByHandleSync(
        weapon.projectileMaterialHandle,
      );

      if (!mesh || !material) {
        console.error(
          `[WeaponSystem] Projectile resources not pre-loaded for handles: ${weapon.projectileMeshHandle}, ${weapon.projectileMaterialHandle}. Firing aborted. Ensure assets are loaded in scene file.`,
        );
        return;
      }

      const projectileEntity = this.world.createEntity();

      const startPosition = vec3.add(rayOrigin, vec3.scale(rayDirection, 1.0));
      const transform = new TransformComponent();
      transform.setPosition(startPosition);
      this.world.addComponent(projectileEntity, transform);

      this.world.addComponent(
        projectileEntity,
        new MeshRendererComponent(mesh, material),
      );

      // Gameplay
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
    }
  }

  /**
   * Updates the system every frame.
   * @remarks
   * This function is responsible for updating weapon cooldowns and processing
   * any incoming raycast results from the physics worker. The actual firing
   * logic is handled by the `onFireWeapon` event listener.
   * @param deltaTime The time elapsed since the last frame in seconds.
   */
  public update(deltaTime: number): void {
    // 1. Update cooldown timers for all weapons
    const allWeaponsQuery = this.world.query([WeaponComponent]);
    for (const entity of allWeaponsQuery) {
      const weapon = this.world.getComponent(entity, WeaponComponent);
      if (weapon && weapon.cooldown > 0) {
        weapon.cooldown -= deltaTime;
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
        if (this.world.hasComponent(hitEntityId, HealthComponent)) {
          const weapon = this.world.getComponent(
            sourceEntityId,
            WeaponComponent,
          );
          if (weapon) {
            this.damageSystem.enqueueDamageEvent({
              target: hitEntityId,
              amount: weapon.damage,
              source: sourceEntityId,
            });
          }
        }
      }
    }
  }
}

// src/shared/ecs/systems/shared/collisionEventSystem.ts
import { World } from "@/shared/ecs/world";
import { PhysicsContext } from "@/shared/state/physicsState";
import { EventManager } from "@/shared/ecs/events/eventManager";
import {
  COLLISION_EVENTS_HEAD_OFFSET,
  COLLISION_EVENTS_RING_CAPACITY,
  COLLISION_EVENTS_SLOT_OFFSET,
  COLLISION_EVENTS_SLOT_SIZE,
  COLLISION_EVENTS_TAIL_OFFSET,
  COLLISION_EVENT_FLAG_STARTED,
  COLLISION_EVENT_FLAG_ENDED,
  COLLISION_EVENT_FLAG_SENSOR_ENTERED,
  COLLISION_EVENT_FLAG_SENSOR_EXITED,
  COLLISION_EVENT_PHYS_ID_A_OFFSET,
  COLLISION_EVENT_PHYS_ID_B_OFFSET,
  COLLISION_EVENT_FLAGS_OFFSET,
  COLLISION_EVENT_CONTACT_X_OFFSET,
  COLLISION_EVENT_CONTACT_Y_OFFSET,
  COLLISION_EVENT_CONTACT_Z_OFFSET,
  COLLISION_EVENT_NORMAL_X_OFFSET,
  COLLISION_EVENT_NORMAL_Y_OFFSET,
  COLLISION_EVENT_NORMAL_Z_OFFSET,
  COLLISION_EVENT_IMPULSE_OFFSET,
  COLLISION_EVENT_PENETRATION_OFFSET,
} from "@/shared/state/sharedPhysicsLayout";
import { int32BitsToFloat, toIndex } from "@/shared/utils/bitConversion";
import { ProjectileComponent } from "@/shared/ecs/components/gameplay/projectileComponent";
import { vec3 } from "wgpu-matrix";

/**
 * Drains the collision event ring buffer from the physics worker and
 * translates physics events into gameplay events.
 *
 * @remarks
 * This system no longer handles damage logic directly. It publishes events
 * for other systems (like ProjectileSystem) to handle gameplay logic.
 */
export class CollisionEventSystem {
  /**
   * @param world - The ECS world, used to access components of colliding entities.
   * @param physCtx - The context for the shared physics buffers, used to read events.
   * @param eventManager - The event manager to publish game events to.
   */
  constructor(
    private world: World,
    private physCtx: PhysicsContext,
    private eventManager: EventManager,
  ) {}

  /**
   * Reads and processes all available collision events from the shared buffer.
   */
  public update(): void {
    const view = this.physCtx.collisionEventsI32;
    if (!view) return;

    let tail = Atomics.load(view, toIndex(COLLISION_EVENTS_TAIL_OFFSET));
    const head = Atomics.load(view, toIndex(COLLISION_EVENTS_HEAD_OFFSET));

    let processedAny = false;

    while (tail !== head) {
      const slotIndex = tail % COLLISION_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        toIndex(COLLISION_EVENTS_SLOT_OFFSET) +
        slotIndex * toIndex(COLLISION_EVENTS_SLOT_SIZE);

      // Read event data
      const physIdA = Atomics.load(
        view,
        slotBaseI32 + toIndex(COLLISION_EVENT_PHYS_ID_A_OFFSET),
      );
      const physIdB = Atomics.load(
        view,
        slotBaseI32 + toIndex(COLLISION_EVENT_PHYS_ID_B_OFFSET),
      );
      const flags = Atomics.load(
        view,
        slotBaseI32 + toIndex(COLLISION_EVENT_FLAGS_OFFSET),
      );

      // Read contact data (stored as i32 bits, convert to f32)
      const contactX = int32BitsToFloat(
        Atomics.load(
          view,
          slotBaseI32 + toIndex(COLLISION_EVENT_CONTACT_X_OFFSET),
        ),
      );
      const contactY = int32BitsToFloat(
        Atomics.load(
          view,
          slotBaseI32 + toIndex(COLLISION_EVENT_CONTACT_Y_OFFSET),
        ),
      );
      const contactZ = int32BitsToFloat(
        Atomics.load(
          view,
          slotBaseI32 + toIndex(COLLISION_EVENT_CONTACT_Z_OFFSET),
        ),
      );

      const normalX = int32BitsToFloat(
        Atomics.load(
          view,
          slotBaseI32 + toIndex(COLLISION_EVENT_NORMAL_X_OFFSET),
        ),
      );
      const normalY = int32BitsToFloat(
        Atomics.load(
          view,
          slotBaseI32 + toIndex(COLLISION_EVENT_NORMAL_Y_OFFSET),
        ),
      );
      const normalZ = int32BitsToFloat(
        Atomics.load(
          view,
          slotBaseI32 + toIndex(COLLISION_EVENT_NORMAL_Z_OFFSET),
        ),
      );

      const impulse = int32BitsToFloat(
        Atomics.load(
          view,
          slotBaseI32 + toIndex(COLLISION_EVENT_IMPULSE_OFFSET),
        ),
      );
      const penetration = int32BitsToFloat(
        Atomics.load(
          view,
          slotBaseI32 + toIndex(COLLISION_EVENT_PENETRATION_OFFSET),
        ),
      );

      // Dispatch based on event type
      switch (flags) {
        case COLLISION_EVENT_FLAG_STARTED:
          this.handleCollisionStarted(
            physIdA,
            physIdB,
            vec3.create(contactX, contactY, contactZ),
            vec3.create(normalX, normalY, normalZ),
            impulse,
            penetration,
          );
          break;

        case COLLISION_EVENT_FLAG_ENDED:
          this.handleCollisionEnded(physIdA, physIdB);
          break;

        case COLLISION_EVENT_FLAG_SENSOR_ENTERED:
          this.handleSensorEntered(physIdA, physIdB);
          break;

        case COLLISION_EVENT_FLAG_SENSOR_EXITED:
          this.handleSensorExited(physIdA, physIdB);
          break;
      }

      tail = (tail + 1) % COLLISION_EVENTS_RING_CAPACITY;
      processedAny = true;
    }

    if (processedAny) {
      Atomics.store(view, toIndex(COLLISION_EVENTS_TAIL_OFFSET), tail);
    }
  }

  /**
   * Handles a collision started event.
   * Publishes the event to the event bus and handles projectile-specific logic.
   */
  private handleCollisionStarted(
    entityA: number,
    entityB: number,
    contactPoint: Float32Array,
    normal: Float32Array,
    impulse: number,
    penetration: number,
  ): void {
    // Publish the collision event to the event bus
    this.eventManager.publish({
      type: "collision-started",
      payload: {
        entityA,
        entityB,
        contactPoint,
        normal,
        impulse,
        penetration,
      },
    });

    // Handle projectile logic - publish impact event with damage data
    const projA = this.world.getComponent(entityA, ProjectileComponent);
    const projB = this.world.getComponent(entityB, ProjectileComponent);

    // Ignore projectile-on-projectile collisions
    if (projA && projB) {
      console.log(
        `[CollisionEventSystem] Ignoring projectile-on-projectile collision: ${entityA} vs ${entityB}`,
      );
      return;
    }

    let projectileEntity: number | null = null;
    let otherEntity: number | null = null;
    let projectileComponent: ProjectileComponent | undefined;

    if (projA) {
      projectileEntity = entityA;
      otherEntity = entityB;
      projectileComponent = projA;
    } else if (projB) {
      projectileEntity = entityB;
      otherEntity = entityA;
      projectileComponent = projB;
    }

    // If a projectile was involved, publish impact event with damage data
    if (projectileEntity && otherEntity && projectileComponent) {
      console.log(
        `[CollisionEventSystem] Projectile ${projectileEntity} hit entity ${otherEntity}`,
      );
      console.log(
        `[CollisionEventSystem] Projectile damage: ${projectileComponent.damage}, owner: ${projectileComponent.owner}`,
      );

      // Don't publish impact for self-hits (let ProjectileSystem handle this logic)
      if (otherEntity !== projectileComponent.owner) {
        const impactEvent = {
          type: "projectile-impact" as const,
          payload: {
            projectile: projectileEntity,
            owner: projectileComponent.owner,
            target: otherEntity,
            position: contactPoint,
            normal: normal,
            damage: projectileComponent.damage, // Include damage from projectile component
            dealtDamage: false, // Will be updated by ProjectileSystem
          },
        };

        console.log(
          `[CollisionEventSystem] Publishing projectile-impact event:`,
          impactEvent.payload,
        );
        this.eventManager.publish(impactEvent);
      } else {
        console.log(
          `[CollisionEventSystem] Ignoring self-hit: projectile ${projectileEntity} hit its owner ${otherEntity}`,
        );
      }

      // Destroy the projectile on any impact
      console.log(
        `[CollisionEventSystem] Destroying projectile ${projectileEntity}`,
      );
      this.world.destroyEntity(projectileEntity);
    }
  }

  /**
   * Handles a collision ended event.
   */
  private handleCollisionEnded(entityA: number, entityB: number): void {
    this.eventManager.publish({
      type: "collision-ended",
      payload: {
        entityA,
        entityB,
      },
    });
  }

  /**
   * Handles a sensor entered event.
   */
  private handleSensorEntered(sensor: number, other: number): void {
    this.eventManager.publish({
      type: "sensor-entered",
      payload: {
        sensor,
        other,
      },
    });
  }

  /**
   * Handles a sensor exited event.
   */
  private handleSensorExited(sensor: number, other: number): void {
    this.eventManager.publish({
      type: "sensor-exited",
      payload: {
        sensor,
        other,
      },
    });
  }
}

// src/core/ecs/systems/collisionEventSystem.ts
import { World } from "@/core/ecs/world";
import { PhysicsContext } from "@/core/physicsState";
import { EventManager } from "@/core/ecs/events/eventManager";
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
} from "@/core/sharedPhysicsLayout";
import { int32BitsToFloat, toIndex } from "@/core/utils/bitConversion";
import { DamageSystem } from "@/core/ecs/systems/damageSystem";
import { ProjectileComponent } from "@/core/ecs/components/projectileComponent";
import { HealthComponent } from "@/core/ecs/components/healthComponent";
import { vec3 } from "wgpu-matrix";

/**
 * Drains the collision event ring buffer from the physics worker and
 * translates physics events into gameplay logic before publishing them to the event bus.
 *
 * @remarks
 * All offsets in sharedPhysicsLayout are expressed in bytes. This system converts
 * them to 32-bit element indices via `toIndex` prior to accessing the shared Int32Array,
 * ensuring collision data such as contact points and normals are read correctly.
 */
export class CollisionEventSystem {
  /**
   * @param world - The ECS world, used to access components of colliding entities.
   * @param physCtx - The context for the shared physics buffers, used to read events.
   * @param eventManager - The event manager to publish game events to.
   * @param damageSystem - The system to which damage events will be enqueued.
   */
  constructor(
    private world: World,
    private physCtx: PhysicsContext,
    private eventManager: EventManager,
    private damageSystem: DamageSystem,
  ) {}

  /**
   * Reads and processes all available collision events from the shared buffer.
   *
   * @remarks
   * This function implements the consumer side of the SPSC collision event
   * ring buffer. It reads events between the `tail` and `head` pointers,
   * dispatches them based on event type, and then atomically advances the
   * `tail` pointer to mark the events as consumed.
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

    // Handle projectile logic (this could be moved to a separate system that listens to collision events)
    const projA = this.world.getComponent(entityA, ProjectileComponent);
    const projB = this.world.getComponent(entityB, ProjectileComponent);

    // Ignore projectile-on-projectile collisions
    if (projA && projB) {
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

    // If a projectile was involved...
    if (projectileEntity && otherEntity && projectileComponent) {
      // Don't let projectiles damage their owner
      if (otherEntity !== projectileComponent.owner) {
        // Check if the other entity can take damage
        if (this.world.hasComponent(otherEntity, HealthComponent)) {
          this.damageSystem.enqueueDamageEvent({
            target: otherEntity,
            amount: projectileComponent.damage,
            source: projectileComponent.owner,
          });
        }
      }

      // Destroy the projectile on any impact
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

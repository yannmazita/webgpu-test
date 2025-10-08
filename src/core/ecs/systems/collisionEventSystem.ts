// src/core/ecs/systems/collisionEventSystem.ts

import { World } from "@/core/ecs/world";
import { PhysicsContext } from "@/core/physicsState";
import {
  COLLISION_EVENTS_HEAD_OFFSET,
  COLLISION_EVENTS_RING_CAPACITY,
  COLLISION_EVENTS_SLOT_OFFSET,
  COLLISION_EVENTS_SLOT_SIZE,
  COLLISION_EVENTS_TAIL_OFFSET,
  COLLISION_EVENT_FLAG_STARTED,
} from "@/core/sharedPhysicsLayout";
import { DamageSystem } from "@/core/ecs/systems/damageSystem";
// import { ProjectileComponent } from "@/core/ecs/components/projectileComponent";

/**
 * Drains the collision event ring buffer from the physics worker and
 * translates physics events into gameplay logic (like damage on impact).
 *
 * @remarks
 * This system acts as the bridge between the raw physics simulation and the
 * game's ECS. It consumes a queue of `(entityA, entityB)` collision pairs
 * from a SharedArrayBuffer and is responsible for determining how to react,
 * such as enqueuing damage events when a projectile hits a player.
 */
export class CollisionEventSystem {
  /**
   * @param world - The ECS world, used to access components of colliding entities.
   * @param physCtx - The context for the shared physics buffers, used to read events.
   * @param damageSystem - The system to which damage events will be enqueued.
   */
  constructor(
    private world: World,
    private physCtx: PhysicsContext,
    private damageSystem: DamageSystem,
  ) {}

  /**
   * Reads and processes all available collision events from the shared buffer.
   *
   * @remarks
   * This function implements the consumer side of the SPSC collision event
   * ring buffer. It reads events between the `tail` and `head` pointers,
   * dispatches them to `handleCollision`, and then atomically advances the
   * `tail` pointer to mark the events as consumed.
   */
  public update(): void {
    const view = this.physCtx.collisionEventsI32;
    if (!view) return;

    let tail = Atomics.load(view, COLLISION_EVENTS_TAIL_OFFSET >> 2);
    const head = Atomics.load(view, COLLISION_EVENTS_HEAD_OFFSET >> 2);

    let processedAny = false;

    while (tail !== head) {
      const slotIndex = tail % COLLISION_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (COLLISION_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (COLLISION_EVENTS_SLOT_SIZE >> 2);

      const physIdA = Atomics.load(view, slotBaseI32 + 0);
      const physIdB = Atomics.load(view, slotBaseI32 + 1);
      const flags = Atomics.load(view, slotBaseI32 + 2);

      // We only care about new collisions for now
      if (flags === COLLISION_EVENT_FLAG_STARTED) {
        this.handleCollision(physIdA, physIdB);
      }

      tail = (tail + 1) % COLLISION_EVENTS_RING_CAPACITY;
      processedAny = true;
    }

    if (processedAny) {
      Atomics.store(view, COLLISION_EVENTS_TAIL_OFFSET >> 2, tail);
    }
  }

  /**
   * Handles the game logic for a collision between two entities.
   *
   * @remarks
   * This is where game-specific logic is implemented. For example, it checks
   * if one entity is a projectile and the other is a damageable target.
   * Future logic could include playing sounds or creating particle effects.
   *
   * @param entityA - The first entity involved in the collision.
   * @param entityB - The second entity involved in the collision.
   */
  private handleCollision(entityA: number, entityB: number): void {
    // This is where projectile logic will go.
    // just logging the collision currently
    console.log(
      `[CollisionEventSystem] Collision detected between ${entityA} and ${entityB}`,
    );

    /*
    // --- Example of future projectile logic ---
    const projA = this.world.getComponent(entityA, ProjectileComponent);
    const projB = this.world.getComponent(entityB, ProjectileComponent);
    */
  }
}

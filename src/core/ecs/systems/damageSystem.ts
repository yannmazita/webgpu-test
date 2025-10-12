// src/core/ecs/systems/damageSystem.ts

import { World } from "@/core/ecs/world";
import { Entity } from "@/core/ecs/entity";
import { HealthComponent } from "@/core/ecs/components/healthComponent";
import { EventManager } from "../events";

/**
 * Represents a single instance of damage to be processed.
 */
export interface DamageEvent {
  target: Entity;
  amount: number;
  source?: Entity;
}

/**
 * A system that processes a queue of damage events each frame.
 * @remarks
 * This decouples damage-dealing systems (like weapons, projectiles, physics
 * collisions) from the health component logic. When an entity's health
 * reaches zero, it publishes a `DeathEvent` to the global event manager
 * instead of destroying the entity directly.
 */
export class DamageSystem {
  private eventQueue: DamageEvent[] = [];

  /**
   * @param eventManager The global event manager to publish death events to.
   */
  constructor(private eventManager: EventManager) {}

  /**
   * Adds a damage event to the queue to be processed on the next update.
   * @param event The damage event to enqueue.
   */
  public enqueueDamageEvent(event: DamageEvent): void {
    this.eventQueue.push(event);
  }

  /**
   * Processes all queued damage events for the current frame.
   * @remarks
   * It applies damage to entities with a HealthComponent. If an entity's
   * health is depleted, it publishes a `DeathEvent` and takes no further
   * action.
   * @param world The ECS world.
   */
  public update(world: World): void {
    if (this.eventQueue.length === 0) {
      return;
    }

    for (const event of this.eventQueue) {
      const health = world.getComponent(event.target, HealthComponent);
      if (!health) {
        continue; // Target has no health component, ignore.
      }

      // Skip if already dead
      if (health.isDead()) {
        continue;
      }

      health.takeDamage(event.amount);
      console.log(
        `[DamageSystem] Entity ${event.target} took ${event.amount} damage. Health remaining: ${health.currentHealth}`,
      );

      if (health.isDead()) {
        console.log(
          `[DamageSystem] Entity ${event.target} has been defeated! Publishing DeathEvent.`,
        );
        this.eventManager.publish({
          type: "death",
          payload: {
            victim: event.target,
            killer: event.source,
          },
        });
      }
    }

    // Clear the queue for the next frame
    this.eventQueue.length = 0;
  }
}

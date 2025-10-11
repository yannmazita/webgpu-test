// src/core/ecs/systems/damageSystem.ts

import { World } from "@/core/ecs/world";
import { Entity } from "@/core/ecs/entity";
import { HealthComponent } from "@/core/ecs/components/healthComponent";

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
 * This decouples damage-dealing systems (like weapons, projectiles, physics
 * collisions) from the health component logic.
 */
export class DamageSystem {
  private eventQueue: DamageEvent[] = [];

  /**
   * Adds a damage event to the queue to be processed on the next update.
   * @param event The damage event to enqueue.
   */
  public enqueueDamageEvent(event: DamageEvent): void {
    this.eventQueue.push(event);
  }

  /**
   * Processes all queued damage events for the current frame.
   * It applies damage to entities with a HealthComponent and handles death.
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
        // TODO: Emit a "death" event or destroy the entity.
        // For now, we just log it.
        console.log(`[DamageSystem] Entity ${event.target} has been defeated!`);
        // Example of what could be done here:
        // world.destroyEntity(event.target);
      }
    }

    // Clear the queue for the next frame
    this.eventQueue.length = 0;
  }
}

// src/core/ecs/systems/damageSystem.ts
import { World } from "@/core/ecs/world";
import { HealthComponent } from "@/core/ecs/components/healthComponent";
import { EventManager } from "@/core/ecs/events";
import { Vec3 } from "wgpu-matrix";

/**
 * Represents a single instance of damage to be processed.
 */
export interface DamageEvent {
  target: number;
  amount: number;
  source?: number;
  damagePoint?: Vec3;
}

/**
 * A system that processes a queue of damage events each frame.
 * @remarks
 * It publishes damage-taken, damage-dealt, and death events.
 */
export class DamageSystem {
  private damageQueue: DamageEvent[] = [];

  /**
   * @param eventManager The global event manager to publish death events to.
   */
  constructor(private eventManager: EventManager) {}

  /**
   * Adds a damage event to the queue to be processed on the next update.
   * @param event The damage event to enqueue.
   */
  public enqueueDamageEvent(event: DamageEvent): void {
    this.damageQueue.push(event);
  }

  /**
   * Processes all queued damage events.
   * Should be called once per frame.
   */
  public update(world: World): void {
    for (const damageEvent of this.damageQueue) {
      this.processDamageEvent(world, damageEvent);
    }
    this.damageQueue.length = 0;
  }
  /**
   * Processes a single damage event.
   */
  private processDamageEvent(world: World, event: DamageEvent): void {
    const { target, amount, source, damagePoint } = event;

    const healthComp = world.getComponent(target, HealthComponent);
    if (!healthComp) {
      return; // Entity doesn't have health
    }

    // Publish damage-taken event BEFORE reducing health
    this.eventManager.publish({
      type: "damage-taken",
      payload: {
        target,
        amount,
        source,
        damagePoint,
      },
    });

    // Apply damage
    healthComp.takeDamage(event.amount);

    // Publish damage-dealt event if there's a source
    if (source !== undefined) {
      this.eventManager.publish({
        type: "damage-dealt",
        payload: {
          source,
          target,
          amount,
        },
      });
    }

    // Check for death
    if (healthComp.isDead()) {
      this.eventManager.publish({
        type: "death",
        payload: {
          victim: target,
          killer: source,
        },
      });
    }
  }

  /**
   * Immediately applies damage without queueing (use sparingly).
   */
  public applyDamageImmediate(
    world: World,
    target: number,
    amount: number,
    source?: number,
    damagePoint?: Vec3,
  ): void {
    this.processDamageEvent(world, { target, amount, source, damagePoint });
  }

  /**
   * Heals an entity (negative damage).
   */
  public enqueueHealEvent(world: World, target: number, amount: number): void {
    const healthComp = world.getComponent(target, HealthComponent);
    if (!healthComp) return;

    healthComp.heal(amount);
  }
}

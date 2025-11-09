// src/shared/ecs/systems/shared/damageSystem.ts
import { World } from "@/shared/ecs/world";
import { HealthComponent } from "@/shared/ecs/components/gameplay/healthComponent";
import { EventManager } from "@/shared/ecs/events/eventManager";
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
    console.log(
      `[DamageSystem] Enqueuing damage event: target=${event.target}, amount=${event.amount}, source=${event.source}`,
    );
    this.damageQueue.push(event);
  }

  /**
   * Processes all queued damage events.
   * Should be called once per frame.
   */
  public update(world: World): void {
    if (this.damageQueue.length === 0) {
      return;
    }

    console.log(
      `[DamageSystem] Processing ${this.damageQueue.length} damage events`,
    );

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

    console.log(
      `[DamageSystem] Processing damage event: target=${target}, amount=${amount}, source=${source}`,
    );

    const healthComp = world.getComponent(target, HealthComponent);
    if (!healthComp) {
      console.warn(
        `[DamageSystem] WARNING: Entity ${target} has no HealthComponent`,
      );
      return; // Entity doesn't have health
    }

    const healthBefore = healthComp.currentHealth;
    console.log(
      `[DamageSystem] Entity ${target} health before damage: ${healthBefore}/${healthComp.maxHealth}`,
    );

    // Publish damage-taken event BEFORE reducing health
    const damageTakenEvent = {
      type: "damage-taken" as const,
      payload: {
        target,
        amount,
        source,
        damagePoint,
      },
    };
    this.eventManager.publish(damageTakenEvent);

    // Apply damage
    healthComp.takeDamage(event.amount);
    const healthAfter = healthComp.currentHealth;
    console.log(
      `[DamageSystem] Entity ${target} health after damage: ${healthAfter}/${healthComp.maxHealth}`,
    );

    // Publish damage-dealt event if there's a source
    if (source !== undefined) {
      const damageDealtEvent = {
        type: "damage-dealt" as const,
        payload: {
          source,
          target,
          amount,
        },
      };
      console.log(
        `[DamageSystem] Publishing damage-dealt event:`,
        damageDealtEvent.payload,
      );
      this.eventManager.publish(damageDealtEvent);
    }

    // Check for death
    const isDead = healthComp.isDead();
    console.log(`[DamageSystem] Entity ${target} isDead: ${isDead}`);

    if (isDead) {
      const deathEvent = {
        type: "death" as const,
        payload: {
          victim: target,
          killer: source,
        },
      };
      this.eventManager.publish(deathEvent);
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
    console.log(
      `[DamageSystem] Applying immediate damage: target=${target}, amount=${amount}`,
    );
    this.processDamageEvent(world, { target, amount, source, damagePoint });
  }

  /**
   * Heals an entity (negative damage).
   */
  public enqueueHealEvent(world: World, target: number, amount: number): void {
    const healthComp = world.getComponent(target, HealthComponent);
    if (!healthComp) {
      console.warn(
        `[DamageSystem] Cannot heal entity ${target} - no HealthComponent`,
      );
      return;
    }

    healthComp.heal(amount);
  }
}

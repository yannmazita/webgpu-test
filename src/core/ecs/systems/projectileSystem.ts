// src/core/ecs/systems/projectileSystem.ts
import { World } from "@/core/ecs/world";
import { EventManager } from "@/core/ecs/events/eventManager";
import { GameEvent } from "@/core/ecs/events/gameEvent";
import { HealthComponent } from "@/core/ecs/components/healthComponent";
import { DamageSystem } from "@/core/ecs/systems/damageSystem";

/**
 * Handles projectile impact events and applies damage.
 * @remarks
 * This system listens for projectile-impact events and handles the damage
 * logic when projectiles hit damageable entities. It reads damage values
 * directly from the impact event payload.
 */
export class ProjectileSystem {
  constructor(
    private world: World,
    private eventManager: EventManager,
    private damageSystem: DamageSystem,
  ) {
    this.eventManager.subscribe(
      "projectile-impact",
      this.onProjectileImpact.bind(this),
    );
  }

  /**
   * Handles projectile impact events.
   * @param event The projectile-impact event containing damage data
   */
  private onProjectileImpact(event: GameEvent): void {
    if (event.type !== "projectile-impact") return;

    const { projectile, owner, target, position, normal, damage } =
      event.payload;

    // Check if the target can take damage
    if (this.world.hasComponent(target, HealthComponent)) {
      // Use the damage value from the impact event payload

      // Enqueue damage event with the actual damage from the projectile
      this.damageSystem.enqueueDamageEvent({
        target,
        amount: damage,
        source: owner,
      });

      // Update the impact event to reflect damage was dealt
      event.payload.dealtDamage = true;

      // Publish damage dealt event for UI/feedback
      this.eventManager.publish({
        type: "damage-dealt",
        payload: {
          source: owner,
          target,
          amount: damage,
        },
      });

      // Publish hit marker for visual feedback
      this.eventManager.publish({
        type: "hit-marker",
        payload: {
          attacker: owner,
          victim: target,
          isCritical: false, // todo: Implement critical hit logic based on hit location or other factors
        },
      });
    }
  }

  /**
   * Update method (currently empty as this system is event-driven).
   */
  public update(): void {
    // This system is entirely event-driven
  }
}

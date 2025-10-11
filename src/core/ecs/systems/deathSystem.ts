// src/core/ecs/systems/deathSystem.ts
import { World } from "@/core/ecs/world";
import { DeathEvent, EventManager } from "@/core/ecs/events";

/** Defines all possible game events. */
interface GameEvent {
  type: "death";
  payload: DeathEvent;
}

/**
 * A system that handles the consequences of an entity's death.
 * @remarks
 * This system subscribes to `DeathEvent`s. Its primary responsibility is to
 * remove the dead entity from the world. In the future, it can be expanded to
 * handle other death-related logic, such as spawning particle effects, playing
 * sounds, or creating ragdolls.
 */
export class DeathSystem {
  /**
   * @param world The ECS world, used to destroy entities.
   * @param eventManager The global event manager to subscribe to.
   */
  constructor(
    private world: World,
    private eventManager: EventManager<GameEvent, "death">,
  ) {
    // The system subscribes to the 'death' event type upon construction.
    // The listener is bound to this instance to maintain the correct `this` context.
    this.eventManager.subscribe("death", this.onDeath.bind(this));
  }

  /**
   * The listener function that is called when a `DeathEvent` is processed.
   * @param event The event containing the death payload.
   */
  private onDeath(event: { type: "death"; payload: DeathEvent }): void {
    console.log(
      `[DeathSystem] Received DeathEvent for entity ${event.payload.victim}. Destroying entity.`,
    );
    // For now, we just destroy the entity.
    // TODO: Add logic for ragdolls, particle effects, etc
    this.world.destroyEntity(event.payload.victim);
  }

  /**
   * The update function for this system.
   * @remarks
   * This system is event-driven, so its update function is currently empty.
   * All of its logic is executed within the `onDeath` event listener, which is
   * called by the EventManager's update method. This function is kept for
   * API consistency with other systems.
   */
  public update(): void {
    // This system is purely event-driven.
  }
}

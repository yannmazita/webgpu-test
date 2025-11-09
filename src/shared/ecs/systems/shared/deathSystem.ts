// src/shared/ecs/systems/shared/deathSystem.ts
import { World } from "@/shared/ecs/world";
import { EventManager } from "@/shared/ecs/events/eventManager";
import { GameEvent } from "@/shared/ecs/events/gameEvent";
import { RespawnComponent } from "@/shared/ecs/components/gameplay/respawnComponent";

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
   * Creates an instance of DeathSystem.
   * @param world The ECS world, used to access and destroy entities.
   * @param eventManager The global event manager to subscribe to and publish from.
   */
  constructor(
    private world: World,
    private eventManager: EventManager,
  ) {
    // The system subscribes to the 'death' event type upon construction.
    // The listener is bound to this instance to maintain the correct `this` context.
    this.eventManager.subscribe("death", this.onDeath.bind(this));
  }

  /**
   * The listener function that is called when a `DeathEvent` is processed.
   * @param event The game event, which must be of type 'death'.
   */
  private onDeath(event: GameEvent): void {
    if (event.type !== "death") return;

    const victim = event.payload.victim;
    console.log(`[DeathSystem] Received DeathEvent for entity ${victim}.`);

    // Check for a respawn component before destroying the entity.
    const respawn = this.world.getComponent(victim, RespawnComponent);
    if (respawn) {
      console.log(
        `[DeathSystem] Entity ${victim} has RespawnComponent. Publishing RequestRespawnEvent.`,
      );
      // Publish an event to request a respawn, passing the necessary data.
      this.eventManager.publish({
        type: "request-respawn",
        payload: {
          prefabId: respawn.prefabId,
          respawnTime: respawn.respawnTime,
          spawnPointTag: respawn.spawnPointTag,
        },
      });
    }

    // The entity is always destroyed, regardless of whether it will respawn.
    // TODO: Add logic for ragdolls, particle effects, etc
    this.world.destroyEntity(victim);
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

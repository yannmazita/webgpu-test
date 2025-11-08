// src/shared/ecs/systems/playerInputSystem.ts
import { World } from "@/shared/ecs/world";
import { PlayerControllerComponent } from "@/shared/ecs/components/playerControllerComponent";
import { EventManager } from "@/shared/ecs/events/eventManager";
import { ActionState } from "@/shared/ecs/components/resources/inputResources";

/**
 * Translates raw player input actions into gameplay intent events.
 * @remarks
 * This system decouples input handling from the systems that act on those
 * intents. It checks for the "fire" action and publishes a `FireWeaponEvent`,
 * which is then processed by the `WeaponSystem`.
 *
 * @param world The ECS world.
 * @param eventManager The global event manager to publish events to.
 */
export function playerInputSystem(
  world: World,
  eventManager: EventManager,
): void {
  const actionState = world.getResource(ActionState);
  if (!actionState) return;

  const query = world.query([PlayerControllerComponent]);
  if (query.length === 0) {
    return;
  }
  const playerEntity = query[0];

  // Check for firing intent
  if (actionState.pressed.has("fire")) {
    eventManager.publish({
      type: "fire-weapon",
      payload: { shooter: playerEntity },
    });
  }
}

// src/core/ecs/systems/playerInputSystem.ts
import { IActionController } from "@/core/input/action";
import { World } from "@/core/ecs/world";
import { PlayerControllerComponent } from "@/core/ecs/components/playerControllerComponent";
import { EventManager } from "@/core/ecs/events";

/**
 * Translates raw player input actions into gameplay intent events.
 * @remarks
 * This system decouples input handling from the systems that act on those
 * intents. It checks for the "fire" action and publishes a `FireWeaponEvent`,
 * which is then processed by the `WeaponSystem`.
 *
 * @param world The ECS world.
 * @param actions The input action controller.
 * @param eventManager The global event manager to publish events to.
 */
export function playerInputSystem(
  world: World,
  actions: IActionController,
  eventManager: EventManager,
): void {
  const query = world.query([PlayerControllerComponent]);
  if (query.length === 0) {
    return;
  }
  const playerEntity = query[0];

  // Check for firing intent
  if (actions.isPressed("fire")) {
    eventManager.publish({
      type: "fire-weapon",
      payload: { shooter: playerEntity },
    });
  }
}

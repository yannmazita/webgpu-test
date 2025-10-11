// src/core/ecs/systems/playerInputSystem.ts

import { IActionController } from "@/core/input/action";
import { World } from "@/core/ecs/world";
import { PlayerControllerComponent } from "@/core/ecs/components/playerControllerComponent";
import { WantsToFireTagComponent } from "@/core/ecs/components/tagComponents";

/**
 * Translates raw player input actions into gameplay intent components.
 * This system decouples input handling from the systems that act on those intents.
 *
 * @remarks
 * It checks for the "fire" action and adds a `WantsToFireTagComponent`
 * to the player entity, which is then processed by the `weaponSystem`.
 *
 * @param world The ECS world.
 * @param actions The input action controller.
 */
export function playerInputSystem(
  world: World,
  actions: IActionController,
): void {
  const query = world.query([PlayerControllerComponent]);
  if (query.length === 0) {
    return;
  }
  const playerEntity = query[0];

  // Check for firing intent
  if (actions.isPressed("fire")) {
    // Add the tag if it doesn't already exist to avoid redundant adds.
    if (!world.hasComponent(playerEntity, WantsToFireTagComponent)) {
      world.addComponent(playerEntity, new WantsToFireTagComponent());
    }
  }
}

// src/core/ecs/systems/input/inputToActionSystem.ts
import { World } from "@/core/ecs/world";
import {
  ActionMap,
  ActionState,
  GamepadInput,
  KeyboardInput,
  MouseButtonInput,
} from "@/core/ecs/components/resources/inputResources";

/**
 * System that translates raw input states into high-level gameplay actions.
 * @remarks
 * This system runs after `RawInputSystem`. It reads the raw input resources
 * (like `Input<KeyCode>`) and the `ActionMap` resource. Based on the mappings,
 * it populates the `ActionState` resource with the state of abstract actions
 * like "jump" or "fire".
 *
 * Gameplay systems should read from `ActionState` rather than raw inputs to
 * remain decoupled from the specific hardware configuration.
 */
export class InputToActionSystem {
  private previousPressedActions = new Set<string>();

  /**
   * Updates the `ActionState` resource based on raw inputs and the `ActionMap`.
   * @param world The ECS world instance.
   */
  public update(world: World): void {
    const actionMap = world.getResource(ActionMap);
    const actionState = world.getResource(ActionState);
    const keyInput = world.getResource(KeyboardInput);
    const mouseButtonInput = world.getResource(MouseButtonInput);
    const gamepadInput = world.getResource(GamepadInput);

    if (
      !actionMap ||
      !actionState ||
      !keyInput ||
      !mouseButtonInput ||
      !gamepadInput
    ) {
      return;
    }

    actionState.clear();
    const currentPressedActions = new Set<string>();

    for (const [actionName, binding] of Object.entries(actionMap.config)) {
      if (binding.type === "button") {
        let isPressed = false;
        // Check keyboard
        if (binding.keys?.some((key) => keyInput.pressed.has(key))) {
          isPressed = true;
        }
        // Check mouse
        if (
          !isPressed &&
          binding.mouseButtons?.some((btn) => mouseButtonInput.pressed.has(btn))
        ) {
          isPressed = true;
        }
        // Check gamepads
        if (!isPressed && binding.gamepadButtons) {
          for (const gamepad of gamepadInput.gamepads.values()) {
            if (
              binding.gamepadButtons.some((btn) =>
                gamepad.buttons.pressed.has(btn),
              )
            ) {
              isPressed = true;
              break;
            }
          }
        }

        if (isPressed) {
          currentPressedActions.add(actionName);
        }
      } else if (binding.type === "axis") {
        let value = 0;
        // Keyboard
        if (binding.positiveKey && keyInput.pressed.has(binding.positiveKey)) {
          value += 1;
        }
        if (binding.negativeKey && keyInput.pressed.has(binding.negativeKey)) {
          value -= 1;
        }

        // Gamepad
        if (binding.gamepadAxis !== undefined) {
          for (const gamepad of gamepadInput.gamepads.values()) {
            const axisValue = gamepad.axes[binding.gamepadAxis];
            if (axisValue !== undefined && Math.abs(axisValue) > 0.05) {
              // Deadzone
              value += axisValue * (binding.gamepadAxisScale ?? 1.0);
              break; // Use first active gamepad
            }
          }
        }

        actionState.axes.set(actionName, Math.max(-1, Math.min(1, value)));
      }
    }

    // Determine justPressed and justReleased actions
    for (const actionName of currentPressedActions) {
      actionState.pressed.add(actionName);
      if (!this.previousPressedActions.has(actionName)) {
        actionState.justPressed.add(actionName);
      }
    }
    for (const actionName of this.previousPressedActions) {
      if (!currentPressedActions.has(actionName)) {
        actionState.justReleased.add(actionName);
      }
    }

    this.previousPressedActions = currentPressedActions;
  }
}

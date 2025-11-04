// src/core/ecs/systems/input/rawInputSystem.ts
import { World } from "@/core/ecs/world";
import {
  Gamepad,
  GamepadInput,
  Input,
  MouseButton,
  MouseInput,
} from "@/core/ecs/components/resources/inputResources";
import { KeyCode, KEY_MAP } from "@/core/input/keycodes";
import { InputContext } from "@/core/input/manager";
import {
  getAndResetMouseDelta,
  getMousePosition,
  isKeyDown,
  isMouseButtonDown,
  isPointerLocked,
} from "@/core/input/manager";
import {
  MOUSE_BUTTON_LEFT,
  MOUSE_BUTTON_MIDDLE,
  MOUSE_BUTTON_RIGHT,
} from "@/core/input/mouseButtons";

/**
 * System that polls raw input sources and populates the corresponding ECS resources.
 * @remarks
 * This system runs at the beginning of each frame. It reads hardware state
 * from the `InputContext` (SharedArrayBuffer) and the browser's Gamepad API.
 *
 * It is responsible for calculating the `justPressed` and `justReleased` states
 * by comparing the current frame's input with the state from the previous frame,
 * which it stores internally. This encapsulates the stateful nature of input
 * polling and provides a clean, stateless view to the rest of the engine.
 */
export class RawInputSystem {
  private previousKeyStates = new Set<KeyCode>();
  private previousMouseButtonStates = new Set<MouseButton>();
  private previousGamepadButtonStates = new Map<number, Set<number>>();

  /**
   * Updates all raw input resources in the world.
   * @param world The ECS world instance.
   * @param inputContext The context for the shared input buffer.
   */
  public update(world: World, inputContext: InputContext): void {
    this.updateKeyboard(world, inputContext);
    this.updateMouse(world, inputContext);
    this.updateGamepads(world);
  }

  private updateKeyboard(world: World, context: InputContext): void {
    const keyInput = world.getResource(Input<KeyCode>);
    if (!keyInput) return;

    keyInput.clear();

    const currentKeyStates = new Set<KeyCode>();
    for (const code of KEY_MAP.keys()) {
      if (isKeyDown(context, code)) {
        currentKeyStates.add(code);
      }
    }

    // Determine justPressed keys
    for (const code of currentKeyStates) {
      if (!this.previousKeyStates.has(code)) {
        keyInput.justPressed.add(code);
      }
      keyInput.pressed.add(code);
    }

    // Determine justReleased keys
    for (const code of this.previousKeyStates) {
      if (!currentKeyStates.has(code)) {
        keyInput.justReleased.add(code);
      }
    }

    this.previousKeyStates = currentKeyStates;
  }

  private updateMouse(world: World, context: InputContext): void {
    const mouseButtonInput = world.getResource(Input<MouseButton>);
    const mouseInput = world.getResource(MouseInput);
    if (!mouseButtonInput || !mouseInput) return;

    mouseButtonInput.clear();

    // --- Buttons ---
    const currentMouseButtonStates = new Set<MouseButton>();
    const buttons: MouseButton[] = [
      MOUSE_BUTTON_LEFT,
      MOUSE_BUTTON_MIDDLE,
      MOUSE_BUTTON_RIGHT,
    ];
    for (const button of buttons) {
      if (isMouseButtonDown(context, button)) {
        currentMouseButtonStates.add(button);
      }
    }

    for (const button of currentMouseButtonStates) {
      if (!this.previousMouseButtonStates.has(button)) {
        mouseButtonInput.justPressed.add(button);
      }
      mouseButtonInput.pressed.add(button);
    }

    for (const button of this.previousMouseButtonStates) {
      if (!currentMouseButtonStates.has(button)) {
        mouseButtonInput.justReleased.add(button);
      }
    }

    this.previousMouseButtonStates = currentMouseButtonStates;

    // --- Movement and State ---
    mouseInput.delta = getAndResetMouseDelta(context);
    mouseInput.position = getMousePosition(context);
    mouseInput.isPointerLocked = isPointerLocked(context);
    // Todo: Mouse wheel is not yet implemented in the shared buffer.
  }

  private updateGamepads(world: World): void {
    const gamepadInput = world.getResource(GamepadInput);
    if (!gamepadInput) return;

    const currentlyConnected = new Set<number>();
    const gamepads = navigator.getGamepads();

    for (const rawGamepad of gamepads) {
      if (!rawGamepad) continue;

      currentlyConnected.add(rawGamepad.index);

      let gamepadState = gamepadInput.gamepads.get(rawGamepad.index);
      if (!gamepadState) {
        gamepadState = new Gamepad(rawGamepad.index);
        gamepadInput.gamepads.set(rawGamepad.index, gamepadState);
      }

      gamepadState.buttons.clear();
      gamepadState.axes = rawGamepad.axes.map((a) => a);

      const currentButtonStates = new Set<number>();
      rawGamepad.buttons.forEach((button, index) => {
        if (button.pressed) {
          currentButtonStates.add(index);
        }
      });

      const previousButtonStates =
        this.previousGamepadButtonStates.get(rawGamepad.index) ?? new Set();

      for (const buttonIndex of currentButtonStates) {
        if (!previousButtonStates.has(buttonIndex)) {
          gamepadState.buttons.justPressed.add(buttonIndex);
        }
        gamepadState.buttons.pressed.add(buttonIndex);
      }

      for (const buttonIndex of previousButtonStates) {
        if (!currentButtonStates.has(buttonIndex)) {
          gamepadState.buttons.justReleased.add(buttonIndex);
        }
      }

      this.previousGamepadButtonStates.set(
        rawGamepad.index,
        currentButtonStates,
      );
    }

    // Remove disconnected gamepads
    for (const index of gamepadInput.gamepads.keys()) {
      if (!currentlyConnected.has(index)) {
        gamepadInput.gamepads.delete(index);
        this.previousGamepadButtonStates.delete(index);
      }
    }
  }
}

// src/shared/ecs/systems/clientOnly/input/rawInputSystem.ts
import { World } from "@/shared/ecs/world";
import {
  Gamepad,
  GamepadInput,
  KeyboardInput,
  MouseButton,
  MouseButtonInput,
  MouseInput,
} from "@/shared/ecs/components/resources/inputResources";
import { KeyCode, KEY_MAP } from "@/client/input/keycodes";
import {
  getGamepadAxis,
  getGamepadButtons,
  InputContext,
} from "@/client/input/manager";
import {
  getAndResetMouseDelta,
  getMousePosition,
  isKeyDown,
  isMouseButtonDown,
  isPointerLocked,
} from "@/client/input/manager";
import {
  MOUSE_BUTTON_LEFT,
  MOUSE_BUTTON_MIDDLE,
  MOUSE_BUTTON_RIGHT,
} from "@/client/input/mouseButtons";
import { GAMEPAD_MAX_AXES, MAX_GAMEPADS } from "@/shared/state/sharedInputLayout";

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
  private previousGamepadButtonStates = new Map<number, number>(); // <gamepadIndex, buttonMask>

  /**
   * Updates all raw input resources in the world.
   * @param world The ECS world instance.
   * @param inputContext The context for the shared input buffer.
   */
  public update(world: World, inputContext: InputContext): void {
    this.updateKeyboard(world, inputContext);
    this.updateMouse(world, inputContext);
    this.updateGamepads(world, inputContext);
  }

  private updateKeyboard(world: World, context: InputContext): void {
    const keyInput = world.getResource(KeyboardInput);
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
    const mouseButtonInput = world.getResource(MouseButtonInput);
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

  private updateGamepads(world: World, context: InputContext): void {
    const gamepadInput = world.getResource(GamepadInput);
    if (!gamepadInput) return;

    const currentlyActive = new Set<number>();

    for (let i = 0; i < MAX_GAMEPADS; i++) {
      const buttonMask = getGamepadButtons(context, i);

      // A non-zero button mask or a non-zero axis value indicates an active pad
      let isConnected = buttonMask !== 0;
      if (!isConnected) {
        for (let j = 0; j < GAMEPAD_MAX_AXES; j++) {
          if (getGamepadAxis(context, i, j) !== 0) {
            isConnected = true;
            break;
          }
        }
      }

      if (!isConnected) continue;

      currentlyActive.add(i);

      let gamepadState = gamepadInput.gamepads.get(i);
      if (!gamepadState) {
        gamepadState = new Gamepad(i);
        gamepadInput.gamepads.set(i, gamepadState);
      }

      gamepadState.buttons.clear();

      // Update axes
      gamepadState.axes.length = GAMEPAD_MAX_AXES;
      for (let j = 0; j < GAMEPAD_MAX_AXES; j++) {
        gamepadState.axes[j] = getGamepadAxis(context, i, j);
      }

      // Update buttons
      const previousButtonMask = this.previousGamepadButtonStates.get(i) ?? 0;

      for (let buttonIndex = 0; buttonIndex < 32; buttonIndex++) {
        const currentBit = 1 << buttonIndex;
        const isPressed = (buttonMask & currentBit) !== 0;
        const wasPressed = (previousButtonMask & currentBit) !== 0;

        if (isPressed) {
          gamepadState.buttons.pressed.add(buttonIndex);
          if (!wasPressed) {
            gamepadState.buttons.justPressed.add(buttonIndex);
          }
        } else {
          if (wasPressed) {
            gamepadState.buttons.justReleased.add(buttonIndex);
          }
        }
      }
      this.previousGamepadButtonStates.set(i, buttonMask);
    }

    // Remove disconnected gamepads
    for (const index of gamepadInput.gamepads.keys()) {
      if (!currentlyActive.has(index)) {
        gamepadInput.gamepads.delete(index);
        this.previousGamepadButtonStates.delete(index);
      }
    }
  }
}

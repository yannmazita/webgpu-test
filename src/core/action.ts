// src/core/action.ts
import { IInputSource } from "./iinputSource";

/** Defines a mapping for a single button action. */
export interface ButtonActionBinding {
  type: "button";
  keys: string[]; // List of KeyboardEvent.code values
}

/** Defines a mapping for a single axis action. */
export interface AxisActionBinding {
  type: "axis";
  positiveKey: string;
  negativeKey: string;
}

/** A union type for all possible action bindings. */
export type ActionBinding = ButtonActionBinding | AxisActionBinding;

/** The configuration object that maps action names to their bindings. */
export type ActionMapConfig = Record<string, ActionBinding>;

/**
 * The interface for an action controller, which provides a high-level API
 * for querying abstract game actions.
 */
export interface IActionController {
  isPressed(actionName: string): boolean;
  wasPressed(actionName: string): boolean;
  getAxis(actionName: string): number;
  getMouseDelta(): { x: number; y: number };
  isPointerLocked(): boolean;
}

/**
 * Checks if a button-type action is currently being pressed.
 * @param actionMap The map defining all actions.
 * @param inputSource The current input state provider.
 * @param actionName The name of the action to check.
 * @returns `true` if any of the keys mapped to the action are pressed.
 */
export function isActionPressed(
  actionMap: ActionMapConfig,
  inputSource: IInputSource,
  actionName: string,
): boolean {
  const binding = actionMap[actionName];
  if (!binding || binding.type !== "button") {
    console.warn(`Action "${actionName}" is not a defined button action.`);
    return false;
  }
  return binding.keys.some((key) => inputSource.isKeyDown(key));
}

/**
 * Gets the value of an axis-type action, typically between -1 and 1.
 * @param actionMap The map defining all actions.
 * @param inputSource The current input state provider.
 * @param actionName The name of the action to check.
 * @returns `1` for positive, `-1` for negative, `0` otherwise.
 */
export function getAxisValue(
  actionMap: ActionMapConfig,
  inputSource: IInputSource,
  actionName: string,
): number {
  const binding = actionMap[actionName];
  if (!binding || binding.type !== "axis") {
    console.warn(`Action "${actionName}" is not a defined axis action.`);
    return 0;
  }
  let value = 0;
  if (inputSource.isKeyDown(binding.positiveKey)) {
    value += 1;
  }
  if (inputSource.isKeyDown(binding.negativeKey)) {
    value -= 1;
  }
  return value;
}

/**
 * A helper map to track the previous state of actions for wasActionPressed.
 * The key is the action name, the value is its pressed state last frame.
 */
export type ActionStateMap = Map<string, boolean>;

/**
 * Checks if a button-type action was just pressed in the current frame.
 * This is useful for toggle actions where you only want to react once per key press.
 * @param actionMap The map defining all actions.
 * @param inputSource The current input state provider.
 * @param actionName The name of the action to check.
 * @param previousState A map tracking the pressed state from the previous frame.
 * @returns `true` if the action is currently pressed but was not pressed last frame.
 */
export function wasActionPressed(
  actionMap: ActionMapConfig,
  inputSource: IInputSource,
  actionName: string,
  previousState: ActionStateMap,
): boolean {
  const binding = actionMap[actionName];
  if (!binding || binding.type !== "button") {
    // Silently return false for non-button or undefined actions
    return false;
  }

  const isPressedNow = isActionPressed(actionMap, inputSource, actionName);
  const wasPressed = previousState.get(actionName) ?? false;

  // Update state for next frame
  previousState.set(actionName, isPressedNow);

  return isPressedNow && !wasPressed;
}

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
 * This checks if any of the keys associated with the action are down.
 * @param actionMap The configuration of all actions.
 * @param inputSource The input source to query key states from.
 * @param name The name of the action to check.
 * @returns True if the action is currently pressed, false otherwise.
 */
export function isActionPressed(
  actionMap: ActionMapConfig,
  inputSource: IInputSource,
  name: string,
): boolean {
  const action = actionMap[name];
  if (!action || action.type !== "button") {
    // This warning is triggered when this function is called for an axis action.
    console.warn(`Action "${name}" is not a defined button action.`);
    return false;
  }
  // An action is pressed if at least one of its assigned keys is down.
  return action.keys.some((key) => inputSource.isKeyDown(key));
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
 * This is a PURE function and does not modify state.
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
    return false;
  }

  const isPressedNow = isActionPressed(actionMap, inputSource, actionName);
  const wasPressed = previousState.get(actionName) ?? false;

  return isPressedNow && !wasPressed;
}

/**
 * Updates the map of previous action states by checking the current state of all actions.
 * This must be called at the end of each frame for `wasPressed` to work correctly.
 * @param controller The action controller to query current state from.
 * @param previousState The map to update with the current states.
 * @param actionMap The configuration of all actions to iterate over.
 */
export function updatePreviousActionState(
  controller: IActionController,
  previousState: ActionStateMap,
  actionMap: ActionMapConfig,
): void {
  for (const actionName of Object.keys(actionMap)) {
    // Only check the pressed state for actions defined as 'button'
    // This prevents warnings for axis-type actions.
    if (actionMap[actionName].type === "button") {
      previousState.set(actionName, controller.isPressed(actionName));
    }
  }
}

// src/core/actionManager.ts
import { InputManager } from "./inputManager";

/**
 * Defines a mapping for a single button action.
 * example: { type: "button", keys: ["Space", "Enter"] }
 */
export interface ButtonActionBinding {
  type: "button";
  keys: string[]; // List of KeyboardEvent.code values
}

/**
 * Defines a mapping for a single axis action.
 * example: { type: "axis", positiveKey: "KeyW", negativeKey: "KeyS" }
 */
export interface AxisActionBinding {
  type: "axis";
  positiveKey: string;
  negativeKey: string;
}

/**
 * A union type for all possible action bindings.
 */
export type ActionBinding = ButtonActionBinding | AxisActionBinding;

/**
 * The configuration object that maps action names to their bindings.
 * This is the "Action Map".
 * example: { "move_vertical": { type: "axis", ... }, "jump": { type: "button", ... } }
 */
export type ActionMapConfig = Record<string, ActionBinding>;

/**
 * Manages abstract actions and maps them to physical inputs.
 * This class translates raw input from an InputManager into named,
 * gameplay-relevant actions like "move_forward" or "jump".
 */
export class ActionManager {
  private inputManager: InputManager;
  private actionMap: ActionMapConfig;

  constructor(inputManager: InputManager, actionMap: ActionMapConfig) {
    this.inputManager = inputManager;
    this.actionMap = actionMap;
  }

  /**
   * Checks if a button-type action is currently being pressed.
   * @param actionName The name of the action to check (e.g., "jump").
   * @returns `true` if any of the keys mapped to the action are pressed.
   */
  public isPressed(actionName: string): boolean {
    const binding = this.actionMap[actionName];
    if (!binding || binding.type !== "button") {
      console.warn(`Action "${actionName}" is not a defined button action.`);
      return false;
    }

    return binding.keys.some((key) => this.inputManager.keys.has(key));
  }

  /**
   * Gets the value of an axis-type action, typically between -1 and 1.
   * @param actionName The name of the action to check (e.g., "move_vertical").
   * @returns `1` if the positive key is pressed, `-1` if the negative key is
   *   pressed, and `0` otherwise.
   */
  public getAxis(actionName: string): number {
    const binding = this.actionMap[actionName];
    if (!binding || binding.type !== "axis") {
      console.warn(`Action "${actionName}" is not a defined axis action.`);
      return 0;
    }

    let value = 0;
    if (this.inputManager.keys.has(binding.positiveKey)) {
      value += 1;
    }
    if (this.inputManager.keys.has(binding.negativeKey)) {
      value -= 1;
    }
    return value;
  }

  /**
   * Gets the mouse delta for the current frame.
   * This is a pass-through to the InputManager for convenience.
   */
  public getMouseDelta(): { x: number; y: number } {
    return this.inputManager.mouseDelta;
  }

  /**
   * Checks if the pointer is currently locked.
   * This is a pass-through to the InputManager.
   */
  public isPointerLocked(): boolean {
    return this.inputManager.isPointerLocked;
  }
}

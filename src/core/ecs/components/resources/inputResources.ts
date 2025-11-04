// src/core/ecs/components/resources/inputResources.ts
import { IComponent } from "@/core/ecs/component";
import { KeyCode } from "@/core/input/keycodes";

/** Defines a mapping for a single button action. */
export interface ButtonActionBinding {
  type: "button";
  keys?: KeyCode[];
  mouseButtons?: MouseButton[];
  gamepadButtons?: GamepadButton[];
}

/** Defines a mapping for a single axis action. */
export interface AxisActionBinding {
  type: "axis";
  positiveKey?: KeyCode;
  negativeKey?: KeyCode;
  gamepadAxis?: number;
  gamepadAxisScale?: number; // ex: -1 to invert
}

/** A union type for all possible action bindings. */
export type ActionBinding = ButtonActionBinding | AxisActionBinding;

/** The configuration object that maps action names to their bindings. */
export type ActionMapConfig = Record<string, ActionBinding>;

// --- New Input Type Aliases ---

/** Represents a mouse button index (0=left, 1=middle, 2=right). */
export type MouseButton = number;

/** Represents a gamepad button index. */
export type GamepadButton = number;

// --- New Input Resources ---

/**
 * A generic resource to hold the state for a category of inputs.
 * @remarks
 * This is used to store the raw state of keyboards, mice, and gamepads.
 * The `RawInputSystem` is responsible for populating this resource each frame.
 *
 * @template T The type of the input identifier (e.g., KeyCode, MouseButton).
 */
export class Input<T> implements IComponent {
  /** A set of all inputs of this type that are currently held down. */
  public readonly pressed = new Set<T>();
  /** A set of all inputs of this type that were pressed for the first time this frame. */
  public readonly justPressed = new Set<T>();
  /** A set of all inputs of this type that were released this frame. */
  public readonly justReleased = new Set<T>();

  /**
   * Clears the per-frame state (justPressed and justReleased).
   * @remarks
   * This is called by the `RawInputSystem` at the beginning of each frame
   * before new state is calculated.
   */
  public clear(): void {
    this.justPressed.clear();
    this.justReleased.clear();
  }
}

/**
 * A resource that holds the state of all mouse input for the current frame.
 * @remarks
 * This resource is populated by the `RawInputSystem`. It consolidates all
 * mouse-specific data, such as movement deltas and pointer lock state.
 */
export class MouseInput implements IComponent {
  /** The movement of the mouse since the last frame. */
  public delta = { x: 0, y: 0 };
  /** The current position of the mouse in screen coordinates. */
  public position = { x: 0, y: 0 };
  /** The change in the mouse wheel scroll since the last frame. */
  public wheel = { deltaX: 0, deltaY: 0, deltaZ: 0 }; // todo: implement is shared buffer
  /** The current pointer lock state. */
  public isPointerLocked = false;
}

/**
 * A helper class that represents the state of a single connected gamepad.
 * @remarks
 * This is not an ECS resource itself but is used by the `GamepadInput` resource.
 */
export class Gamepad {
  public id: number;
  public axes: number[] = [];
  public buttons: Input<GamepadButton> = new Input<GamepadButton>();

  constructor(id: number) {
    this.id = id;
  }
}

/**
 * A resource that manages the state of all connected gamepads.
 * @remarks
 * This resource is populated by the `RawInputSystem` each frame by polling
 * `navigator.getGamepads()`.
 */
export class GamepadInput implements IComponent {
  /** A map of all currently active gamepads, keyed by their index. */
  public readonly gamepads = new Map<number, Gamepad>();
}

/**
 * A resource that holds the processed, high-level state of gameplay actions.
 * @remarks
 * This resource is the primary interface for gameplay systems to query input.
 * It is populated by the `InputToActionSystem`, which translates raw input
 * from the `Input<T>` resources into abstract actions like "jump" or "fire".
 */
export class ActionState implements IComponent {
  /** A set of all button-type actions that are currently active. */
  public readonly pressed = new Set<string>();
  /** A set of all button-type actions that became active this frame. */
  public readonly justPressed = new Set<string>();
  /** A set of all button-type actions that became inactive this frame. */
  public readonly justReleased = new Set<string>();
  /** A map of all axis-type actions to their current value (typically between -1.0 and 1.0). */
  public readonly axes = new Map<string, number>();

  /**
   * Clears the per-frame state.
   * @remarks
   * This is called by the `InputToActionSystem` at the beginning of each frame.
   */
  public clear(): void {
    this.justPressed.clear();
    this.justReleased.clear();
    this.axes.clear();
    // 'pressed' is rebuilt from scratch, so it doesn't need clearing if populated correctly.
    this.pressed.clear();
  }
}

/**
 * A resource that holds the configuration for mapping raw inputs to actions.
 * @remarks
 * Making the action map a resource allows for runtime modification, such as
 * in-game key re-binding. The `InputToActionSystem` reads from this resource
 * to perform its mapping logic.
 */
export class ActionMap implements IComponent {
  public config: ActionMapConfig;

  /**
   * @param config The initial action map configuration.
   */
  constructor(config: ActionMapConfig) {
    this.config = config;
  }

  /**
   * Updates the binding for an existing action or adds a new one.
   * @param actionName The name of the action to add or update.
   * @param binding The new binding for the action.
   */
  public setAction(actionName: string, binding: ActionBinding): void {
    this.config[actionName] = binding;
  }

  /**
   * Removes an action from the map.
   * @param actionName The name of the action to remove.
   */
  public removeAction(actionName: string): void {
    delete this.config[actionName];
  }
}

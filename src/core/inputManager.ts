// src/core/inputManager.ts
import { IInputSource } from "./iinputSource";
import {
  KEY_MAP,
  KEYS_OFFSET,
  MOUSE_DELTA_X_OFFSET,
  MOUSE_DELTA_Y_OFFSET,
  IS_POINTER_LOCKED_OFFSET,
  SHARED_BUFFER_SIZE,
  MOUSE_POS_X_OFFSET,
  MOUSE_POS_Y_OFFSET,
} from "./sharedInputLayout";

/**
 * Manages user input from keyboard and mouse for the main thread.
 * Writes the input state into a SharedArrayBuffer for consumption by the worker.
 */
export class InputManager implements IInputSource {
  public readonly sharedBuffer: SharedArrayBuffer;
  private int32View: Int32Array;
  private uint8View: Uint8Array;
  private mouseX = 0;
  private mouseY = 0;

  // Internal state for the main thread.
  private isPointerLockedState = false;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.sharedBuffer = new SharedArrayBuffer(SHARED_BUFFER_SIZE);
    this.int32View = new Int32Array(this.sharedBuffer);
    this.uint8View = new Uint8Array(this.sharedBuffer);
    this.addEventListeners();
  }

  // --- IInputSource Implementation ---

  isKeyDown(code: string): boolean {
    const keyIndex = KEY_MAP.get(code);
    if (keyIndex === undefined) return false;
    // This read is for main-thread logic if ever needed.
    // It doesn't need to be atomic relative to itself.
    return this.uint8View[KEYS_OFFSET + keyIndex] === 1;
  }

  getMouseDelta(): { x: number; y: number } {
    // This read is for main-thread logic.
    return {
      x: this.int32View[MOUSE_DELTA_X_OFFSET / 4],
      y: this.int32View[MOUSE_DELTA_Y_OFFSET / 4],
    };
  }

  isPointerLocked(): boolean {
    return this.isPointerLockedState;
  }

  // --- Public Methods ---

  private addEventListeners(): void {
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("keyup", this.handleKeyUp);
    document.addEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
    this.canvas.addEventListener("click", this.handleCanvasClick);
    document.addEventListener("mousemove", this.handleMouseMove);
  }

  public destroy(): void {
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
    document.removeEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
    this.canvas.removeEventListener("click", this.handleCanvasClick);
    document.removeEventListener("mousemove", this.handleMouseMove);
  }

  /**
   * Resets mouse delta in the shared buffer.
   * Should be called at the end of each frame.
   */
  public lateUpdate(): void {
    // Intentionally empty (for now). The worker resets the mouse delta via
    // Atomics.exchange.
  }

  // --- Event Handlers ---

  private handleKeyDown = (e: KeyboardEvent): void => {
    const keyIndex = KEY_MAP.get(e.code);
    if (keyIndex !== undefined) {
      Atomics.store(this.uint8View, KEYS_OFFSET + keyIndex, 1);
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    const keyIndex = KEY_MAP.get(e.code);
    if (keyIndex !== undefined) {
      Atomics.store(this.uint8View, KEYS_OFFSET + keyIndex, 0);
    }
  };

  private handleCanvasClick = (): void => {
    if (!this.isPointerLockedState) {
      this.canvas.requestPointerLock();
    }
  };

  private handlePointerLockChange = (): void => {
    this.isPointerLockedState = document.pointerLockElement === this.canvas;
    Atomics.store(
      this.uint8View,
      IS_POINTER_LOCKED_OFFSET,
      this.isPointerLockedState ? 1 : 0,
    );

    // When entering pointer lock, reset absolute mouse pos to canvas center
    if (this.isPointerLockedState) {
      const w = this.canvas.clientWidth || 0;
      const h = this.canvas.clientHeight || 0;
      this.mouseX = Math.max(0, Math.floor(w * 0.5));
      this.mouseY = Math.max(0, Math.floor(h * 0.5));
      Atomics.store(this.int32View, MOUSE_POS_X_OFFSET / 4, this.mouseX);
      Atomics.store(this.int32View, MOUSE_POS_Y_OFFSET / 4, this.mouseY);
    }
  };

  private handleMouseMove = (e: MouseEvent): void => {
    const w = this.canvas.clientWidth || 0;
    const h = this.canvas.clientHeight || 0;

    if (this.isPointerLockedState) {
      // Accumulate deltas atomically for the worker to consume
      Atomics.add(this.int32View, MOUSE_DELTA_X_OFFSET / 4, e.movementX);
      Atomics.add(this.int32View, MOUSE_DELTA_Y_OFFSET / 4, e.movementY);

      // Maintain an internal absolute position while locked (clamped)
      this.mouseX = Math.min(
        Math.max(this.mouseX + e.movementX, 0),
        Math.max(0, w - 1),
      );
      this.mouseY = Math.min(
        Math.max(this.mouseY + e.movementY, 0),
        Math.max(0, h - 1),
      );
    } else {
      // Compute position relative to the canvas in CSS pixels
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = Math.min(
        Math.max(Math.floor(e.clientX - rect.left), 0),
        Math.max(0, w - 1),
      );
      this.mouseY = Math.min(
        Math.max(Math.floor(e.clientY - rect.top), 0),
        Math.max(0, h - 1),
      );
    }

    // Publish absolute mouse position for the worker (CSS pixels)
    Atomics.store(this.int32View, MOUSE_POS_X_OFFSET / 4, this.mouseX);
    Atomics.store(this.int32View, MOUSE_POS_Y_OFFSET / 4, this.mouseY);
  };

  getMousePosition(): { x: number; y: number } {
    // Main-thread convenience; reading the shared buffer mirrors what the worker does
    const x = Atomics.load(this.int32View, MOUSE_POS_X_OFFSET / 4);
    const y = Atomics.load(this.int32View, MOUSE_POS_Y_OFFSET / 4);
    return { x, y };
  }
}

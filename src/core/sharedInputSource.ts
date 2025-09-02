// src/core/sharedInputSource.ts
import { IInputSource } from "./iinputSource";
import {
  KEY_MAP,
  KEYS_OFFSET,
  MOUSE_DELTA_X_OFFSET,
  MOUSE_DELTA_Y_OFFSET,
  IS_POINTER_LOCKED_OFFSET,
  MOUSE_POS_X_OFFSET,
  MOUSE_POS_Y_OFFSET,
} from "./sharedInputLayout";

/**
 * An implementation of IInputSource that reads its state from a
 * SharedArrayBuffer, allowing for zero-latency input from the main thread.
 */
export class SharedInputSource implements IInputSource {
  private int32View: Int32Array;
  private uint8View: Uint8Array;

  constructor(sharedBuffer: SharedArrayBuffer) {
    this.int32View = new Int32Array(sharedBuffer);
    this.uint8View = new Uint8Array(sharedBuffer);
  }

  public isKeyDown(code: string): boolean {
    const keyIndex = KEY_MAP.get(code);
    if (keyIndex === undefined) {
      return false;
    }
    // Atomically load the key state (0 or 1).
    return Atomics.load(this.uint8View, KEYS_OFFSET + keyIndex) === 1;
  }

  public getMouseDelta(): { x: number; y: number } {
    // Atomically read the current delta values and reset them to 0.
    const x = Atomics.exchange(this.int32View, MOUSE_DELTA_X_OFFSET / 4, 0);
    const y = Atomics.exchange(this.int32View, MOUSE_DELTA_Y_OFFSET / 4, 0);
    return { x, y };
  }

  public getMousePosition(): { x: number; y: number } {
    const x = Atomics.load(this.int32View, MOUSE_POS_X_OFFSET / 4);
    const y = Atomics.load(this.int32View, MOUSE_POS_Y_OFFSET / 4);
    return { x, y };
  }

  public isPointerLocked(): boolean {
    return Atomics.load(this.uint8View, IS_POINTER_LOCKED_OFFSET) === 1;
  }

  /**
   * lateUpdate is a no-op for the shared source, as the main thread
   * InputManager is responsible for resetting the state (mouse delta).
   */
  public lateUpdate(): void {
    // Intentionally empty.
  }
}

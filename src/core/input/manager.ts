// src/core/input/manager.ts
import {
  SHARED_BUFFER_SIZE,
  INPUT_MAGIC,
  INPUT_VERSION,
  INPUT_MAGIC_OFFSET,
  INPUT_VERSION_OFFSET,
  KEY_STATE_OFFSET,
  MOUSE_DX_OFFSET,
  MOUSE_DY_OFFSET,
  POINTER_LOCK_OFFSET,
  MOUSE_X_OFFSET,
  MOUSE_Y_OFFSET,
} from "@/core/sharedInputLayout";

/** The context object holding views for the input buffer. */
export interface InputContext {
  int32View: Int32Array;
  uint8View: Uint8Array;
}

/**
 * Creates a context for the input buffer.
 * @param buffer The SharedArrayBuffer for input.
 * @param isWriter Whether this context is for the writer (main thread).
 */
export function createInputContext(
  buffer: SharedArrayBuffer,
  isWriter: boolean,
): InputContext {
  if (buffer.byteLength !== SHARED_BUFFER_SIZE) {
    throw new Error("Invalid input buffer size");
  }
  const int32View = new Int32Array(buffer);

  if (isWriter) {
    Atomics.store(int32View, INPUT_MAGIC_OFFSET >> 2, INPUT_MAGIC);
    Atomics.store(int32View, INPUT_VERSION_OFFSET >> 2, INPUT_VERSION);
  } else {
    if (Atomics.load(int32View, INPUT_MAGIC_OFFSET >> 2) !== INPUT_MAGIC) {
      throw new Error("Input buffer magic mismatch");
    }
    if (Atomics.load(int32View, INPUT_VERSION_OFFSET >> 2) !== INPUT_VERSION) {
      throw new Error("Input buffer version mismatch");
    }
  }

  return {
    int32View,
    uint8View: new Uint8Array(buffer),
  };
}

// --- Writer Functions (for Main Thread) ---

import { KEY_MAP } from "./keycodes";

/**
 * Updates the state of a key in the shared buffer.
 * @param ctx The input context.
 * @param code The key code.
 * @param isDown Whether the key is down.
 */
export function updateKeyState(
  ctx: InputContext,
  code: string,
  isDown: boolean,
): void {
  const keyIndex = KEY_MAP.get(code);
  if (keyIndex !== undefined) {
    Atomics.store(ctx.uint8View, KEY_STATE_OFFSET + keyIndex, isDown ? 1 : 0);
  }
}

/**
 * Accumulates the mouse delta in the shared buffer.
 * @param ctx The input context.
 * @param dx The change in x.
 * @param dy The change in y.
 */
export function accumulateMouseDelta(
  ctx: InputContext,
  dx: number,
  dy: number,
): void {
  Atomics.add(ctx.int32View, MOUSE_DX_OFFSET >> 2, dx);
  Atomics.add(ctx.int32View, MOUSE_DY_OFFSET >> 2, dy);
}

/**
 * Updates the mouse position in the shared buffer.
 * @param ctx The input context.
 * @param x The x position.
 * @param y The y position.
 */
export function updateMousePosition(
  ctx: InputContext,
  x: number,
  y: number,
): void {
  Atomics.store(ctx.int32View, MOUSE_X_OFFSET >> 2, x);
  Atomics.store(ctx.int32View, MOUSE_Y_OFFSET >> 2, y);
}

/**
 * Updates the pointer lock state in the shared buffer.
 * @param ctx The input context.
 * @param isLocked Whether the pointer is locked.
 */
export function updatePointerLock(ctx: InputContext, isLocked: boolean): void {
  Atomics.store(ctx.uint8View, POINTER_LOCK_OFFSET, isLocked ? 1 : 0);
}

// --- Reader Functions (for Worker Thread) ---

/**
 * Checks if a key is down.
 * @param ctx The input context.
 * @param code The key code.
 * @returns True if the key is down, false otherwise.
 */
export function isKeyDown(ctx: InputContext, code: string): boolean {
  const keyIndex = KEY_MAP.get(code);
  if (keyIndex !== undefined) {
    return Atomics.load(ctx.uint8View, KEY_STATE_OFFSET + keyIndex) === 1;
  }
  return false;
}

/**
 * Gets the mouse delta and resets it to zero.
 * @param ctx The input context.
 * @returns The mouse delta.
 */
export function getAndResetMouseDelta(ctx: InputContext): {
  x: number;
  y: number;
} {
  const x = Atomics.exchange(ctx.int32View, MOUSE_DX_OFFSET >> 2, 0);
  const y = Atomics.exchange(ctx.int32View, MOUSE_DY_OFFSET >> 2, 0);
  return { x, y };
}

/**
 * Gets the mouse position.
 * @param ctx The input context.
 * @returns The mouse position.
 */
export function getMousePosition(ctx: InputContext): { x: number; y: number } {
  const x = Atomics.load(ctx.int32View, MOUSE_X_OFFSET >> 2);
  const y = Atomics.load(ctx.int32View, MOUSE_Y_OFFSET >> 2);
  return { x, y };
}

/**
 * Checks if the pointer is locked.
 * @param ctx The input context.
 * @returns True if the pointer is locked, false otherwise.
 */
export function isPointerLocked(ctx: InputContext): boolean {
  return Atomics.load(ctx.uint8View, POINTER_LOCK_OFFSET) === 1;
}

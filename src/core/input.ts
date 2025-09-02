// src/core/input.ts
import {
  SHARED_BUFFER_SIZE,
  KEY_MAP,
  KEYS_OFFSET,
  MOUSE_DELTA_X_OFFSET,
  MOUSE_DELTA_Y_OFFSET,
  IS_POINTER_LOCKED_OFFSET,
  MOUSE_POS_X_OFFSET,
  MOUSE_POS_Y_OFFSET,
} from "./sharedInputLayout";

/** The context object holding views for the input buffer. */
export interface InputContext {
  int32View: Int32Array;
  uint8View: Uint8Array;
}

/**
 * Creates a context for the input buffer.
 * @param buffer The SharedArrayBuffer for input.
 */
export function createInputContext(buffer: SharedArrayBuffer): InputContext {
  if (buffer.byteLength !== SHARED_BUFFER_SIZE) {
    throw new Error("Invalid input buffer size");
  }
  return {
    int32View: new Int32Array(buffer),
    uint8View: new Uint8Array(buffer),
  };
}

// --- Writer Functions (for Main Thread) ---

export function updateKeyState(
  ctx: InputContext,
  code: string,
  isDown: boolean,
): void {
  const keyIndex = KEY_MAP.get(code);
  if (keyIndex !== undefined) {
    Atomics.store(ctx.uint8View, KEYS_OFFSET + keyIndex, isDown ? 1 : 0);
  }
}

export function accumulateMouseDelta(
  ctx: InputContext,
  dx: number,
  dy: number,
): void {
  Atomics.add(ctx.int32View, MOUSE_DELTA_X_OFFSET >> 2, dx);
  Atomics.add(ctx.int32View, MOUSE_DELTA_Y_OFFSET >> 2, dy);
}

export function updateMousePosition(
  ctx: InputContext,
  x: number,
  y: number,
): void {
  Atomics.store(ctx.int32View, MOUSE_POS_X_OFFSET >> 2, x);
  Atomics.store(ctx.int32View, MOUSE_POS_Y_OFFSET >> 2, y);
}

export function updatePointerLock(ctx: InputContext, isLocked: boolean): void {
  Atomics.store(ctx.uint8View, IS_POINTER_LOCKED_OFFSET, isLocked ? 1 : 0);
}

// --- Reader Functions (for Worker Thread) ---

export function isKeyDown(ctx: InputContext, code: string): boolean {
  const keyIndex = KEY_MAP.get(code);
  if (keyIndex === undefined) return false;
  return Atomics.load(ctx.uint8View, KEYS_OFFSET + keyIndex) === 1;
}

export function getAndResetMouseDelta(ctx: InputContext): {
  x: number;
  y: number;
} {
  const x = Atomics.exchange(ctx.int32View, MOUSE_DELTA_X_OFFSET >> 2, 0);
  const y = Atomics.exchange(ctx.int32View, MOUSE_DELTA_Y_OFFSET >> 2, 0);
  return { x, y };
}

export function getMousePosition(ctx: InputContext): { x: number; y: number } {
  const x = Atomics.load(ctx.int32View, MOUSE_POS_X_OFFSET >> 2);
  const y = Atomics.load(ctx.int32View, MOUSE_POS_Y_OFFSET >> 2);
  return { x, y };
}

export function isPointerLocked(ctx: InputContext): boolean {
  return Atomics.load(ctx.uint8View, IS_POINTER_LOCKED_OFFSET) === 1;
}

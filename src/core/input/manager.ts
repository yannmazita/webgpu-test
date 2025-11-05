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
  MOUSE_BUTTONS_OFFSET,
  GAMEPAD_STATE_OFFSET,
  GAMEPAD_SLOT_SIZE,
  GAMEPAD_BUTTONS_OFFSET,
  GAMEPAD_AXES_OFFSET,
  MAX_GAMEPADS,
  GAMEPAD_MAX_AXES,
} from "@/core/sharedInputLayout";
import { KEY_MAP, KeyCode } from "@/core/input/keycodes";

/** The context object holding views for the input buffer. */
export interface InputContext {
  int32View: Int32Array;
  uint8View: Uint8Array;
  float32View: Float32Array;
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
    throw new Error(
      `Invalid input buffer size. Expected ${SHARED_BUFFER_SIZE}, got ${buffer.byteLength}`,
    );
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
    float32View: new Float32Array(buffer),
  };
}

// --- Writer Functions (for Main Thread) ---

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
  const keyIndex = KEY_MAP.get(code as KeyCode);
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

/**
 * Updates the state of a mouse button in the shared buffer.
 * @param ctx The input context.
 * @param button The mouse button index (e.g., 0 for left, 1 for middle, 2 for right).
 * @param isDown Whether the button is pressed.
 */
export function updateMouseButtonState(
  ctx: InputContext,
  button: number,
  isDown: boolean,
): void {
  const buttonMask = 1 << button;
  if (isDown) {
    Atomics.or(ctx.int32View, MOUSE_BUTTONS_OFFSET >> 2, buttonMask);
  } else {
    Atomics.and(ctx.int32View, MOUSE_BUTTONS_OFFSET >> 2, ~buttonMask);
  }
}

/**
 * Updates the state of a gamepad in the shared buffer.
 * @param ctx The input context.
 * @param gamepadIndex The index of the gamepad (0-3).
 * @param buttonMask A bitmask of the pressed buttons.
 * @param axes An array of the axis values.
 */
export function updateGamepadState(
  ctx: InputContext,
  gamepadIndex: number,
  buttonMask: number,
  axes: readonly number[],
): void {
  if (gamepadIndex < 0 || gamepadIndex >= MAX_GAMEPADS) {
    return;
  }

  const slotOffset = GAMEPAD_STATE_OFFSET + gamepadIndex * GAMEPAD_SLOT_SIZE;
  const buttonsOffsetI32 = (slotOffset + GAMEPAD_BUTTONS_OFFSET) >> 2;
  const axesOffsetF32 = (slotOffset + GAMEPAD_AXES_OFFSET) >> 2;

  Atomics.store(ctx.int32View, buttonsOffsetI32, buttonMask);

  for (let i = 0; i < GAMEPAD_MAX_AXES; i++) {
    const value = axes[i] ?? 0;
    // We can use non-atomic stores here because the main thread is the only writer
    // and the worker only reads. This is safe as long as we assume the worker
    // might see a partially-updated state for a single frame, which is acceptable for gamepad axes.
    ctx.float32View[axesOffsetF32 + i] = value;
  }
}

/**
 * Clears the state for a specific gamepad slot.
 * @param ctx The input context.
 * @param gamepadIndex The index of the gamepad to clear.
 */
export function clearGamepadState(
  ctx: InputContext,
  gamepadIndex: number,
): void {
  if (gamepadIndex < 0 || gamepadIndex >= MAX_GAMEPADS) {
    return;
  }
  // A button mask of 0 indicates a disconnected or inactive pad.
  updateGamepadState(ctx, gamepadIndex, 0, []);
}

// --- Reader Functions (for Worker Thread) ---

/**
 * Checks if a key is down.
 * @param ctx The input context.
 * @param code The key code.
 * @returns True if the key is down, false otherwise.
 */
export function isKeyDown(ctx: InputContext, code: string): boolean {
  const keyIndex = KEY_MAP.get(code as KeyCode);
  if (keyIndex !== undefined) {
    return Atomics.load(ctx.uint8View, KEY_STATE_OFFSET + keyIndex) === 1;
  }
  return false;
}

/**
 * Checks if a mouse button is down.
 * @param ctx The input context.
 * @param button The mouse button index.
 * @returns True if the button is down, false otherwise.
 */
export function isMouseButtonDown(ctx: InputContext, button: number): boolean {
  const buttonMask = 1 << button;
  return (
    (Atomics.load(ctx.int32View, MOUSE_BUTTONS_OFFSET >> 2) & buttonMask) !== 0
  );
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

/**
 * Gets the button bitmask for a given gamepad.
 * @param ctx The input context.
 * @param gamepadIndex The index of the gamepad.
 * @returns The button bitmask.
 */
export function getGamepadButtons(
  ctx: InputContext,
  gamepadIndex: number,
): number {
  if (gamepadIndex < 0 || gamepadIndex >= MAX_GAMEPADS) {
    return 0;
  }
  const slotOffset = GAMEPAD_STATE_OFFSET + gamepadIndex * GAMEPAD_SLOT_SIZE;
  const buttonsOffsetI32 = (slotOffset + GAMEPAD_BUTTONS_OFFSET) >> 2;
  return Atomics.load(ctx.int32View, buttonsOffsetI32);
}

/**
 * Gets the value of a specific axis for a given gamepad.
 * @param ctx The input context.
 * @param gamepadIndex The index of the gamepad.
 * @param axisIndex The index of the axis.
 * @returns The axis value.
 */
export function getGamepadAxis(
  ctx: InputContext,
  gamepadIndex: number,
  axisIndex: number,
): number {
  if (
    gamepadIndex < 0 ||
    gamepadIndex >= MAX_GAMEPADS ||
    axisIndex < 0 ||
    axisIndex >= GAMEPAD_MAX_AXES
  ) {
    return 0;
  }
  const slotOffset = GAMEPAD_STATE_OFFSET + gamepadIndex * GAMEPAD_SLOT_SIZE;
  const axesOffsetF32 = (slotOffset + GAMEPAD_AXES_OFFSET) >> 2;
  // Non-atomic load is acceptable here for the same reason as the non-atomic store.
  return ctx.float32View[axesOffsetF32 + axisIndex];
}

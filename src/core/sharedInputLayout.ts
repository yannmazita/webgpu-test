// src/core/sharedInputLayout.ts

// A list of keyboard codes we want to track in the shared buffer.
// The order of this array is important as it determines the offset for each key.
export const SUPPORTED_KEYS = [
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "Space",
  "ShiftLeft",
  "KeyQ",
  "KeyE",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyC",
] as const; // Use 'as const' for type safety

// Create a map for quick lookups of the index of a key (and thus its offset).
export const KEY_MAP: Map<string, number> = new Map(
  SUPPORTED_KEYS.map((key, index) => [key, index]),
);

// Memory Layout
// All values are byte offsets. We use Int32 for mouse values to handle
// large, fast mouse movements without clamping.

// Mouse delta X: 4 bytes
export const MOUSE_DELTA_X_OFFSET = 0;
// Mouse delta Y: 4 bytes
export const MOUSE_DELTA_Y_OFFSET = 4;
// Pointer lock state (0 or 1): 1 byte
export const IS_POINTER_LOCKED_OFFSET = 8;

// Absolute mouse position in CSS pixels (Int32)
export const MOUSE_POS_X_OFFSET = 12; // 4 bytes
export const MOUSE_POS_Y_OFFSET = 16; // 4 bytes

// Start of the key states block (uint8s)
export const KEYS_OFFSET = 20;

// Total size needed for the buffer, padded to a multiple of 4 for Int32Array views.
export const SHARED_BUFFER_SIZE =
  Math.ceil((KEYS_OFFSET + SUPPORTED_KEYS.length) / 4) * 4;

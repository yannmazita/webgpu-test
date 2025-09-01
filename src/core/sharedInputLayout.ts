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
// Padding to ensure 4-byte alignment for the keys array if needed
// const PADDING = 3;

// Start of the key states block
export const KEYS_OFFSET = 12;

// Total size needed for the buffer
export const SHARED_BUFFER_SIZE = KEYS_OFFSET + SUPPORTED_KEYS.length;

// src/core/sharedInputLayout.ts

// Header magic/version for schema validation
export const INPUT_MAGIC = 0x494e5054; // 'INPT'
export const INPUT_VERSION = 1;

// Offsets (in BYTES)
export const INPUT_MAGIC_OFFSET = 0;
export const INPUT_VERSION_OFFSET = 4;

// Mouse Data
export const MOUSE_X_OFFSET = 8;
export const MOUSE_Y_OFFSET = 12;
export const MOUSE_DX_OFFSET = 16;
export const MOUSE_DY_OFFSET = 20;
export const MOUSE_BUTTONS_OFFSET = 24;
export const POINTER_LOCK_OFFSET = 28;

// Keyboard Data
export const KEY_STATE_OFFSET = 32;
// Track 256 keys as bytes (Uint8), 1 byte per key
export const KEY_STATE_COUNT = 256;
export const KEY_STATE_SIZE = KEY_STATE_COUNT; // 256 bytes

// Total buffer size
export const SHARED_BUFFER_SIZE = KEY_STATE_OFFSET + KEY_STATE_SIZE;

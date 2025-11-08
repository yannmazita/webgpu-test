// src/shared/state/sharedInputLayout.ts

/**
 * SharedArrayBuffer layout for low-latency input sharing.
 *
 * This file mirrors the style of other shared layouts (engine/metrics/physics):
 * - Pure constants (MAGIC, VERSION, OFFSETS, SIZES)
 * - All OFFSETS are expressed in BYTES and are Int32-aligned where applicable
 * - No functions or classes; import these constants where SAB access is required
 *
 * Design:
 * - Main thread captures DOM input (mouse/keyboard) and writes into this SAB.
 * - The render worker reads from the SAB every frame (FRAME message cadence).
 * - Mouse delta (dx/dy) is accumulated on the writer side; the reader typically
 *   consumes and resets it each frame (see input manager implementation).
 *
 * Notes:
 * - Convert byte offsets to view indices with >> 2 for Int32Array/Float32Array.
 * - Keyboard state is a Uint8Array view (1 byte per key, 256 keys).
 * - Bit layout for mouse buttons is implementation-defined (commonly:
 *   bit0=Left, bit1=Right, bit2=Middle, then aux buttons).
 */

/* ==========================================================================================
 * Header (common)
 * Layout (bytes):
 *   [0]   MAGIC     (u32)  - 'INPT'
 *   [4]   VERSION   (u32)
 * ======================================================================================== */

/** Header magic/version for schema validation */
export const INPUT_MAGIC = 0x494e5054; // 'INPT'
export const INPUT_VERSION = 1;

/** Offsets (in BYTES) */
export const INPUT_MAGIC_OFFSET = 0;
export const INPUT_VERSION_OFFSET = 4;

/* ==========================================================================================
 * Mouse block
 * Layout (bytes):
 *   [8]   MOUSE_X          (i32 or f32)  - screen/client X (implementation choice)
 *   [12]  MOUSE_Y          (i32 or f32)  - screen/client Y
 *   [16]  MOUSE_DX         (i32 or f32)  - accumulated delta X (frame to frame)
 *   [20]  MOUSE_DY         (i32 or f32)  - accumulated delta Y
 *   [24]  MOUSE_BUTTONS    (i32)         - bitmask of pressed buttons
 *   [28]  POINTER_LOCK     (i32)         - 0/1 pointer lock state
 *
 * Notes:
 * - The exact numeric type used (Int32 vs Float32) is determined by the input
 *   manager’s view; the offsets remain valid since both share the same bytes.
 * ======================================================================================== */

/** Mouse Data */
export const MOUSE_X_OFFSET = 8;
export const MOUSE_Y_OFFSET = 12;
export const MOUSE_DX_OFFSET = 16;
export const MOUSE_DY_OFFSET = 20;
export const MOUSE_BUTTONS_OFFSET = 24;
export const POINTER_LOCK_OFFSET = 28;

/* ==========================================================================================
 * Keyboard block
 * Layout (bytes):
 *   [32]  KEY_STATE[256] (u8)  - 1 byte per key (0=up, 1=down), 256 scancodes/keys
 *
 * Notes:
 * - Consumers should create a Uint8Array view over the SAB starting at
 *   KEY_STATE_OFFSET and length KEY_STATE_SIZE.
 * - Keycode mapping is handled by the input manager (ie code → index).
 * ======================================================================================== */

/** Keyboard Data */
export const KEY_STATE_OFFSET = 32;
/** Track 256 keys as bytes (Uint8), 1 byte per key */
export const KEY_STATE_COUNT = 256;
export const KEY_STATE_SIZE = KEY_STATE_COUNT; // 256 bytes

/* ==========================================================================================
 * Gamepad block
 * Layout (bytes):
 *   [288] GAMEPAD_STATE[4] - Block for 4 gamepads
 *
 * Each gamepad slot (36 bytes):
 *   [0]  BUTTONS (u32)     - Bitmask for up to 32 buttons
 *   [4]  AXES[8] (f32)     - 8 axes, 4 bytes per axis (32 bytes total)
 *
 * Notes:
 * - A gamepad is considered "connected" if its button mask is non-zero or any
 *   axis has a non-zero value. The worker thread can check this to avoid
 *   processing disconnected pads.
 * ======================================================================================== */

export const MAX_GAMEPADS = 4;
export const GAMEPAD_MAX_AXES = 8;
export const GAMEPAD_BUTTONS_OFFSET = 0; // Relative to slot start
export const GAMEPAD_AXES_OFFSET = 4; // Relative to slot start
export const GAMEPAD_SLOT_SIZE = GAMEPAD_AXES_OFFSET + GAMEPAD_MAX_AXES * 4; // 4 + 8*4 = 36 bytes per gamepad

export const GAMEPAD_STATE_OFFSET = KEY_STATE_OFFSET + KEY_STATE_SIZE; // Starts after keyboard block
export const GAMEPAD_STATE_SIZE = MAX_GAMEPADS * GAMEPAD_SLOT_SIZE; // 4 * 36 = 144 bytes

/* ==========================================================================================
 * Total buffer sizing
 * ======================================================================================== */

/** Total buffer size (bytes). Keep contiguous for simple views. */
export const SHARED_BUFFER_SIZE = GAMEPAD_STATE_OFFSET + GAMEPAD_STATE_SIZE; // 288 + 144 = 432 bytes

/* ==========================================================================================
 * Usage Notes:
 * - All OFFSETS are in BYTES; convert to Int32/Float32 indices with >> 2 if using such views.
 * - Writer (main thread):
 *     - Updates mouse position/buttons/lock and accumulates dx/dy from events.
 *     - Updates keyboard byte states (Uint8Array).
 * - Reader (render worker):
 *     - Reads mouse/keyboard states each frame.
 *     - Optionally resets MOUSE_DX/MOUSE_DY after consuming (implementation detail).
 * - The layout is intentionally compact to reduce cross-thread cache pressure.
 * ======================================================================================== */

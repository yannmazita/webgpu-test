// src/core/sharedPhysicsLayout.ts

/**
 * SharedArrayBuffer layouts for physics synchronization.
 *
 * This file mirrors the style of other shared layouts (input/metrics/engine state):
 * - Pure constants (magic, versions, offsets, sizes, enums)
 * - All offsets expressed in BYTES and Int32-aligned where applicable
 * - No functions, no classes; import these constants in workers/systems
 *
 * Design:
 * - Commands SAB (render → physics): Single-producer (render) / single-consumer (physics)
 *   ring buffer with HEAD/TAIL indices. Fixed capacity to avoid dynamic allocations.
 * - States SAB (physics → render): Triple-buffered snapshots (0..2) to avoid tearing.
 *   Each snapshot contains a body count and a fixed-capacity array of body records
 *   (PHYS_ID + position + rotation).
 *
 * Notes:
 * - Atomics are required for HEAD/TAIL and slot selection indices (WRITE_INDEX/GEN).
 * - All sizes/offsets are in BYTES (convert to element indices by >> 2 on Int32/Float32 views).
 */

/* ==========================================================================================
 * Header (common)
 * ======================================================================================== */

/** Magic number for physics SAB validation ('PHYS'). */
export const PHYSICS_MAGIC = 0x50485953; // 'PHYS'
/** Current schema version. */
export const PHYSICS_VERSION = 1;

/* ==========================================================================================
 * Commands SAB (render → physics)
 * Layout (bytes):
 *   [0]   MAGIC (u32)
 *   [4]   VERSION (u32)
 *   [8]   HEAD (u32)  - next write index (producer increments)
 *   [12]  TAIL (u32)  - next read index (consumer increments)
 *   [16]  GEN  (u32)  - optional generation counter (debug/observability)
 *   [20]  SLOTS ...   - ring buffer (COMMANDS_RING_CAPACITY slots)
 *
 * Slot layout (per slot, bytes):
 *   [0]   TYPE (u32)  - CMD_* enum
 *   [4]   PHYS_ID (u32)
 *   [8]   PARAMS (f32[12]) - type-specific parameter block (48 bytes)
 *   [56]  PAD (to 64B)
 * ======================================================================================== */

/** Commands: magic/version offsets (bytes). */
export const COMMANDS_MAGIC_OFFSET = 0;
export const COMMANDS_VERSION_OFFSET = 4;
/** Commands ring indices/gen offsets (bytes). */
export const COMMANDS_HEAD_OFFSET = 8; // Atomic u32: write head (render advances)
export const COMMANDS_TAIL_OFFSET = 12; // Atomic u32: read tail (physics advances)
export const COMMANDS_GEN_OFFSET = 16; // u32: increments on buffer changes

/** Commands ring header size (bytes). */
export const COMMANDS_HEADER_BYTES = 24;

/** Commands ring capacity (number of slots). */
export const COMMANDS_RING_CAPACITY = 256;

/** Bytes per command slot (padded to 80 for alignment and larger commands). */
export const COMMANDS_SLOT_SIZE = 80;

/** Max f32 parameters per command slot. (80 - 8 byte header) / 4 bytes per float */
export const COMMANDS_MAX_PARAMS_F32 = 18;

/** First slot byte offset (bytes). */
export const COMMANDS_SLOT_OFFSET = COMMANDS_HEADER_BYTES;

/** Total commands SAB size (bytes). */
export const COMMANDS_BUFFER_SIZE =
  COMMANDS_HEADER_BYTES + COMMANDS_RING_CAPACITY * COMMANDS_SLOT_SIZE;

/* ==========================================================================================
 * States SAB (physics → render)
 * Layout (bytes):
 *   [0]   MAGIC (u32)
 *   [4]   VERSION (u32)
 *   [8]   WRITE_INDEX (u32)  - 0..2, next slot physics will write
 *   [12]  READ_GEN (u32)     - optional read-side generation (debug/observability)
 *   [16]  GEN (u32)          - global generation counter (increments per publish)
 *   [20]  SLOTS ...          - triple buffer (3 slots)
 *
 * Slot layout (per slot, bytes):
 *   [0]   COUNT (u32)                     - number of valid body records in this slot
 *   [4]   BODY[0] ... BODY[COUNT-1]
 *
 * Body record layout (bytes):
 *   [0]   PHYS_ID (u32)                   - engine-side physics ID
 *   [4]   POSITION.xyz (f32x3)            - world-space position
 *   [16]  ROTATION.xyzw (f32x4)           - world-space orientation (unit quaternion)
 *   [32]  ON_GROUND (f32)                 - 1.0 if on ground (for player), 0.0 otherwise
 *   Stride = 36 bytes per body
 * ======================================================================================== */

/** States: magic/version offsets (bytes). */
export const STATES_MAGIC_OFFSET = 0;
export const STATES_VERSION_OFFSET = 4;
/** States: write/read/gen offsets (bytes). */
export const STATES_WRITE_INDEX_OFFSET = 8; // Atomic u32: 0-2 (current write slot)
export const STATES_READ_GEN_OFFSET = 12; // u32: read-side generation (optional)
export const STATES_GEN_OFFSET = 16; // u32: global generation counter

/** States: physics step time (ms, f32) */
export const STATES_PHYSICS_STEP_TIME_MS_OFFSET = 20; // f32: wall time for world.step()

/** States header size (bytes). Padded to 4-byte alignment. */
export const STATES_HEADER_BYTES = 24;

/** Number of snapshot slots (triple-buffer). */
export const STATES_SLOT_COUNT = 3;

/** Max bodies per snapshot slot. Increase for larger scenes. */
export const STATES_MAX_BODIES = 4096;

/** Bytes per body record (u32 id + f32[3] pos + f32[4] rot + i32 flag). */
export const STATES_BODY_STRIDE_BYTES = 36;

/** Bytes per slot: COUNT(u32) + BODY records. */
export const STATES_SLOT_SIZE =
  4 + STATES_MAX_BODIES * STATES_BODY_STRIDE_BYTES;

/** First slot byte offset (bytes). */
export const STATES_SLOT_OFFSET = STATES_HEADER_BYTES;

/** Total states SAB size (bytes). */
export const STATES_BUFFER_SIZE =
  STATES_HEADER_BYTES + STATES_SLOT_COUNT * STATES_SLOT_SIZE;

/* ==========================================================================================
 * Command types (u32)
 * ======================================================================================== */

/** Command type: Create a body (type and params in PARAMS block). */
export const CMD_CREATE_BODY = 1;
/** Command type: Destroy a body by PHYS_ID. */
export const CMD_DESTROY_BODY = 2;
/** Command type: Set a body's transform (kinematic/teleport). */
export const CMD_SET_TRANSFORM = 3;
/** Command type: Set global gravity. */
export const CMD_SET_GRAVITY = 4;
/** Command type: Move a player. */
export const CMD_MOVE_PLAYER = 5;

/* ==========================================================================================
 * Usage Notes:
 * - All offsets are BYTES; when indexing Int32Array/Float32Array, convert with >> 2.
 * - States SAB is written by physics worker only; render worker reads latest slot.
 * - Commands SAB is written by render worker only; physics worker drains it.
 * - Tune COMMANDS_RING_CAPACITY and STATES_MAX_BODIES as needed for scale.
 * ======================================================================================== */

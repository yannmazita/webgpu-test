// src/shared/state/sharedPhysicsLayout.ts

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

/** Bytes per command slot (padded for alignment and larger commands). */
export const COMMANDS_SLOT_SIZE = 96;

/** Max f32 parameters per command slot. (96 - 8 byte header) / 4 bytes per float */
export const COMMANDS_MAX_PARAMS_F32 = 22;

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
/** Command type: Perform a weapon raycast. */
export const CMD_WEAPON_RAYCAST = 6;
/** Command type: Perform an interaction raycast. */
export const CMD_INTERACTION_RAYCAST = 7;

/**
 * Defines the indices for parameters within the `CMD_CREATE_BODY` command's
 * floating-point parameter block. Using these constants prevents errors from
 * mismatched ordering between the command system and the physics worker.
 */
export const CMD_CREATE_BODY_PARAMS = {
  COLLIDER_TYPE: 0,
  PARAM_0: 1,
  PARAM_1: 2,
  PARAM_2: 3,
  POS_X: 4,
  POS_Y: 5,
  POS_Z: 6,
  ROT_X: 7,
  ROT_Y: 8,
  ROT_Z: 9,
  ROT_W: 10,
  BODY_TYPE: 11,
  IS_PLAYER: 12,
  // Player controller specific
  SLOPE_ANGLE: 13,
  MAX_STEP_HEIGHT: 14,
  SLIDE_ENABLED: 15,
  MAX_SLOPE_FOR_GROUND: 16,
  // Initial velocity
  VEL_X: 17,
  VEL_Y: 18,
  VEL_Z: 19,
};

/* ==========================================================================================
 * Raycast Results SAB (physics → render)
 * A single-slot buffer to return the result of the last weapon raycast.
 * Layout (bytes):
 *   [0]   MAGIC (u32) - 'RSLT'
 *   [4]   VERSION (u32)
 *   [8]   GEN (u32) - Generation counter. Incremented by physics on write.
 *   [12]  SOURCE_ENTITY_ID (u32) - The physId of the entity that fired the ray.
 *   [16]  HIT_ENTITY_ID (u32) - 0 if no hit, otherwise the physId of the hit body.
 *   [20]  HIT_DISTANCE (f32)
 *   [24]  HIT_POINT_X (f32)
 *   [28]  HIT_POINT_Y (f32)
 *   [32]  HIT_POINT_Z (f32)
 * ======================================================================================== */

/** Magic number for raycast results SAB validation ('RSLT'). */
export const RAYCAST_RESULTS_MAGIC = 0x52534c54; // 'RSLT'
/** Current schema version for raycast results. */
export const RAYCAST_RESULTS_VERSION = 1;

export const RAYCAST_RESULTS_MAGIC_OFFSET = 0;
export const RAYCAST_RESULTS_VERSION_OFFSET = 4;
export const RAYCAST_RESULTS_GEN_OFFSET = 8;
export const RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET = 12;
export const RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET = 16;
export const RAYCAST_RESULTS_HIT_DISTANCE_OFFSET = 20;
export const RAYCAST_RESULTS_HIT_POINT_OFFSET = 24;

/** Total raycast results SAB size (bytes), padded to a multiple of 16. */
export const RAYCAST_RESULTS_BUFFER_SIZE = 48;

/* ==========================================================================================
 * Interaction Raycast Results SAB (physics → render)
 * A single-slot buffer to return the result of the last interaction raycast.
 * This is kept separate from weapon raycasts to avoid race conditions.
 * Layout (bytes):
 *   [0]   MAGIC (u32) - 'IRAY'
 *   [4]   VERSION (u32)
 *   [8]   GEN (u32) - Generation counter. Incremented by physics on write.
 *   [12]  SOURCE_ENTITY_ID (u32) - The physId of the entity that fired the ray.
 *   [16]  HIT_ENTITY_ID (u32) - 0 if no hit, otherwise the physId of the hit body.
 *   [20]  HIT_DISTANCE (f32)
 * ======================================================================================== */

/** Magic number for interaction raycast results SAB validation ('IRAY'). */
export const INTERACTION_RAYCAST_RESULTS_MAGIC = 0x49524159; // 'IRAY'
/** Current schema version for interaction raycast results. */
export const INTERACTION_RAYCAST_RESULTS_VERSION = 1;

export const INTERACTION_RAYCAST_RESULTS_MAGIC_OFFSET = 0;
export const INTERACTION_RAYCAST_RESULTS_VERSION_OFFSET = 4;
export const INTERACTION_RAYCAST_RESULTS_GEN_OFFSET = 8;
export const INTERACTION_RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET = 12;
export const INTERACTION_RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET = 16;
export const INTERACTION_RAYCAST_RESULTS_HIT_DISTANCE_OFFSET = 20;

/** Total interaction raycast results SAB size (bytes), padded to a multiple of 16. */
export const INTERACTION_RAYCAST_RESULTS_BUFFER_SIZE = 32;

/* ==========================================================================================
 * Collision Events SAB (physics → render)
 * A ring buffer to return collision events (ie projectile hits).
 *
 * This buffer is written to by the `physicsWorker` after it drains the Rapier
 * `EventQueue`. It is consumed by the `CollisionEventSystem` in the main
 * worker (`worker.ts`) to translate physics interactions into gameplay logic.
 *
 * Slot layout (per slot, bytes):
 *  [0-3]   physIdA (i32)
 *  [4-7]   physIdB (i32)
 *  [8-11]  flags (i32) - started=1, ended=2, sensor_entered=3, sensor_exited=4
 *  [12-15] reserved (i32)
 *  [16-27] contactPoint (3 x f32 as i32 bitcast)
 *  [28-39] normal (3 x f32 as i32 bitcast)
 *  [40-43] impulse (f32 as i32 bitcast)
 *  [44-47] penetration (f32 as i32 bitcast)
 *  [48-79] reserved for future use
 * ======================================================================================== */

/** Magic number for collision events SAB validation ('COLL'). */
export const COLLISION_EVENTS_MAGIC = 0x434f4c4c; // 'COLL'
/** Current schema version for collision events. */
export const COLLISION_EVENTS_VERSION = 1;

export const COLLISION_EVENTS_MAGIC_OFFSET = 0;
export const COLLISION_EVENTS_VERSION_OFFSET = 4;
export const COLLISION_EVENTS_HEAD_OFFSET = 8; // Write head (physics worker advances)
export const COLLISION_EVENTS_TAIL_OFFSET = 12; // Read tail (render worker advances)
export const COLLISION_EVENTS_GEN_OFFSET = 16;

export const COLLISION_EVENTS_HEADER_BYTES = 24;
export const COLLISION_EVENTS_RING_CAPACITY = 256;
export const COLLISION_EVENTS_SLOT_SIZE = 80; // 20 x i32 (80 bytes per event)

export const COLLISION_EVENTS_SLOT_OFFSET = COLLISION_EVENTS_HEADER_BYTES;
export const COLLISION_EVENTS_BUFFER_SIZE =
  COLLISION_EVENTS_HEADER_BYTES +
  COLLISION_EVENTS_RING_CAPACITY * COLLISION_EVENTS_SLOT_SIZE;

// Flags for collision events
export const COLLISION_EVENT_FLAG_STARTED = 1;
export const COLLISION_EVENT_FLAG_ENDED = 2;
export const COLLISION_EVENT_FLAG_SENSOR_ENTERED = 3;
export const COLLISION_EVENT_FLAG_SENSOR_EXITED = 4;

// Slot field byte offsets (relative to slot base)
export const COLLISION_EVENT_PHYS_ID_A_OFFSET = 0;
export const COLLISION_EVENT_PHYS_ID_B_OFFSET = 4;
export const COLLISION_EVENT_FLAGS_OFFSET = 8;
export const COLLISION_EVENT_RESERVED_0_OFFSET = 12;
export const COLLISION_EVENT_CONTACT_X_OFFSET = 16;
export const COLLISION_EVENT_CONTACT_Y_OFFSET = 20;
export const COLLISION_EVENT_CONTACT_Z_OFFSET = 24;
export const COLLISION_EVENT_NORMAL_X_OFFSET = 28;
export const COLLISION_EVENT_NORMAL_Y_OFFSET = 32;
export const COLLISION_EVENT_NORMAL_Z_OFFSET = 36;
export const COLLISION_EVENT_IMPULSE_OFFSET = 40;
export const COLLISION_EVENT_PENETRATION_OFFSET = 44;

/* ==========================================================================================
 * Character controller Events SAB (physics → render)
 * A ring buffer to return character controller events (ie character is airborne).
 *
 * Slot layout (per slot, bytes):
 *  Layout per slot (16 x i32 = 64 bytes):
 *  [0-3]   physId (i32)
 *  [4-7]   eventType (i32) - grounded=1, airborne=2, wall_contact=3, step=4, ceiling=5, slide_start=6, slide_stop=7
 *  [8-11]  reserved (i32)
 *  [12-15] reserved (i32)
 *  [16-27] eventData1 (3 x f32) - context-dependent (ie wall normal, step height)
 *  [28-31] eventData2 (f32) - additional context
 *  [32-35] groundEntityId (i32) - entity standing on (if applicable)
 *  [36-63] reserved
 * ======================================================================================== */

export const CHAR_CONTROLLER_EVENTS_MAGIC_OFFSET = 0; // i32 - magic number
export const CHAR_CONTROLLER_EVENTS_VERSION_OFFSET = 4; // i32 - layout version
export const CHAR_CONTROLLER_EVENTS_HEAD_OFFSET = 8; // i32 - producer write index
export const CHAR_CONTROLLER_EVENTS_TAIL_OFFSET = 12; // i32 - consumer read index
export const CHAR_CONTROLLER_EVENTS_GEN_OFFSET = 16;

export const CHAR_CONTROLLER_EVENTS_HEADER_BYTES = 24;
export const CHAR_CONTROLLER_EVENTS_RING_CAPACITY = 64;
export const CHAR_CONTROLLER_EVENTS_SLOT_SIZE = 64; // 16 x i32

export const CHAR_CONTROLLER_EVENTS_SLOT_OFFSET =
  CHAR_CONTROLLER_EVENTS_HEADER_BYTES;
export const CHAR_CONTROLLER_EVENTS_BUFFER_SIZE =
  CHAR_CONTROLLER_EVENTS_HEADER_BYTES +
  CHAR_CONTROLLER_EVENTS_RING_CAPACITY * CHAR_CONTROLLER_EVENTS_SLOT_SIZE;

// Magic number and version
export const CHAR_CONTROLLER_EVENTS_MAGIC = 0x43484152; // "CHAR"
export const CHAR_CONTROLLER_EVENTS_VERSION = 1;

// Character controller event types
export const CHAR_EVENT_GROUNDED = 1;
export const CHAR_EVENT_AIRBORNE = 2;
export const CHAR_EVENT_WALL_CONTACT = 3;
export const CHAR_EVENT_STEP_CLIMBED = 4;
export const CHAR_EVENT_CEILING_HIT = 5;
export const CHAR_EVENT_SLIDE_START = 6;
export const CHAR_EVENT_SLIDE_STOP = 7;

// Slot field byte offsets (relative to slot base)
export const CHAR_EVENT_PHYS_ID_OFFSET = 0;
export const CHAR_EVENT_TYPE_OFFSET = 4;
export const CHAR_EVENT_RESERVED_0_OFFSET = 8;
export const CHAR_EVENT_RESERVED_1_OFFSET = 12;
export const CHAR_EVENT_DATA1_X_OFFSET = 16;
export const CHAR_EVENT_DATA1_Y_OFFSET = 20;
export const CHAR_EVENT_DATA1_Z_OFFSET = 24;
export const CHAR_EVENT_DATA2_OFFSET = 28;
export const CHAR_EVENT_GROUND_ENTITY_OFFSET = 32;

/* ==========================================================================================
 * Usage Notes:
 * - All offsets are BYTES; when indexing Int32Array/Float32Array, convert with >> 2.
 * - Data flow:
 *   - Commands SAB: written by render worker, drained by physics worker.
 *   - States SAB: written by physics worker, read by render worker.
 *   - Collision Events SAB: written by physics worker, drained by render worker.
 * - Tune ring capacities (COMMANDS_*, COLLISION_EVENTS_*) and STATES_MAX_BODIES
 *   as needed for scene complexity and interaction frequency.
 * ======================================================================================== */

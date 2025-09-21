// src/core/sharedEngineStateLayout.ts

/**
 * SharedArrayBuffer layout for engine/editor state synchronization.
 *
 * This file mirrors the style of other shared layouts (input/metrics/physics):
 * - Pure constants (MAGIC, VERSION, OFFSETS, SIZES, DIRTY FLAG enums)
 * - All OFFSETS are expressed in BYTES and are Int32-aligned where applicable
 * - No functions or classes; import these constants where SAB access is required
 *
 * Design:
 * - The main thread (ImGui editor) writes raw values into the SAB (Float32/Int32 views),
 *   then publishes a "dirty" bit via Atomics.or(FLAGS). The render worker consumes those
 *   dirty bits with Atomics.exchange(FLAGS, 0), applies changes to ECS resources, and bumps
 *   a GENERATION counter for observability.
 *
 * Memory ordering pattern:
 * - Writer (main): Write floats/ints → Atomics.or(FLAGS)
 * - Reader (worker): mask = Atomics.exchange(FLAGS, 0) → Read floats/ints → Atomics.add(GEN, 1)
 *
 * Notes:
 * - Convert byte offsets to view indices with >> 2 when accessing Int32Array/Float32Array.
 * - All blocks below are sized/placed with 16-byte alignment for simplicity.
 * - This buffer is intended to be a single-writer (main) / single-reader (render worker)
 *   lock-free channel for low-latency editor controls (fog/sun/shadows).
 */

/* ==========================================================================================
 * Header (common)
 * Layout (bytes):
 *   [0]   MAGIC          (u32)  - 'ENGS'
 *   [4]   VERSION        (u32)
 *   [8]   FLAGS0         (u32)  - DIRTY FLAGS bitfield (main sets; worker clears via exchange)
 *   [12]  GEN            (u32)  - GENERATION counter (worker increments after applying)
 * ======================================================================================== */

/** Header magic/version for schema validation */
export const ENGINE_STATE_MAGIC = 0x454e4753; // 'ENGS'
export const ENGINE_STATE_VERSION = 1;

/** Offsets (in BYTES) — Int32-aligned header */
export const ENGINE_STATE_MAGIC_OFFSET = 0;
export const ENGINE_STATE_VERSION_OFFSET = 4;

/** DIRTY FLAGS bitfields (Uint32) */
export const ENGINE_STATE_FLAGS0_OFFSET = 8;
/** GENERATION counter (Uint32): increments when worker applies any changes */
export const ENGINE_STATE_GEN_OFFSET = 12;

/* ==========================================================================================
 * Fog block
 * Layout (bytes; starts at 16 to keep 16B alignment):
 *   [16]  FOG_ENABLED    (i32)        - 0/1
 *   [20]  (pad)
 *   [32]  FOG_COLOR      (f32x4)      - rgba
 *   [48]  FOG_PARAMS0    (f32x4)      - [density, height, heightFalloff, inscatteringIntensity]
 * ======================================================================================== */

/** Data starts at 16B
 * Fog
 */
export const FOG_ENABLED_OFFSET = 16; // Int32 (0/1)
export const FOG_COLOR_OFFSET = 32; // Float32[4] rgba
export const FOG_PARAMS0_OFFSET = 48; // Float32[4] = [density, height, heightFalloff, inscatteringIntensity]

/* ==========================================================================================
 * Sun block
 * Layout (bytes):
 *   [64]  SUN_ENABLED        (i32)   - 0/1
 *   [68]  SUN_CASTS_SHADOWS  (i32)   - 0/1
 *   [72]  (pad)
 *   [80]  SUN_DIRECTION      (f32x4) - dir.xyz, pad
 *   [96]  SUN_COLOR          (f32x4) - rgb + intensity in w
 * ======================================================================================== */

/** Sun */
export const SUN_ENABLED_OFFSET = 64; // Int32 (0/1)
export const SUN_CASTS_SHADOWS_OFFSET = 68; // Int32 (0/1)
export const SUN_DIRECTION_OFFSET = 80; // Float32[4] = dir.xyz, pad
export const SUN_COLOR_OFFSET = 96; // Float32[4] = rgb + intensity in w

/* ==========================================================================================
 * Shadows block
 * Layout (bytes):
 *   [112] SHADOW_MAP_SIZE    (i32)
 *   [116] (pad)
 *   [128] SHADOW_PARAMS0     (f32x4) - [slopeScaleBias, constantBias, depthBias, pcfRadius]
 *   [144] SHADOW_PARAMS1     (f32x4) - [orthoHalfExtent, 0, 0, 0]
 * ======================================================================================== */

/** Shadows */
export const SHADOW_MAP_SIZE_OFFSET = 112; // Int32
export const SHADOW_PARAMS0_OFFSET = 128; // Float32[4] = [slopeScaleBias, constantBias, depthBias, pcfRadius]
export const SHADOW_PARAMS1_OFFSET = 144; // Float32[4] = [orthoHalfExtent, 0, 0, 0]

/* ==========================================================================================
 * Total buffer sizing
 * ======================================================================================== */

/** Total buffer size (pad to multiple of 16) */
export const SHARED_ENGINE_STATE_BUFFER_SIZE = 160;

/* ==========================================================================================
 * DIRTY FLAG bits for FLAGS0 (writer ORs; reader EXCHANGEs then applies)
 * ======================================================================================== */

export const DF_FOG_ENABLED = 1 << 0;
export const DF_FOG_COLOR = 1 << 1;
export const DF_FOG_PARAMS0 = 1 << 2;

export const DF_SUN_ENABLED = 1 << 3;
export const DF_SUN_DIRECTION = 1 << 4;
export const DF_SUN_COLOR = 1 << 5;
export const DF_SUN_CASTS_SHADOWS = 1 << 9;

export const DF_SHADOW_MAP_SIZE = 1 << 6;
export const DF_SHADOW_PARAMS0 = 1 << 7;
export const DF_SHADOW_PARAMS1 = 1 << 8;

/* ==========================================================================================
 * Usage Notes:
 * - All OFFSETS are in BYTES; convert to Int32/Float32 indices with >> 2.
 * - Main thread (editor):
 *     - Writes raw values to f32/i32 views
 *     - Publishes with Atomics.or(FLAGS0, DF_*)
 * - Render worker:
 *     - mask = Atomics.exchange(FLAGS0, 0)
 *     - Applies each block if corresponding DF_* bit is set
 *     - Atomics.add(GEN, 1) after successful apply (optional for UI observability)
 * - Keep blocks 16B-aligned for easier SIMD-friendly reads/writes if needed later.
 * ======================================================================================== */

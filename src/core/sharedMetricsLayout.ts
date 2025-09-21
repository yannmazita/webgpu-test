// src/core/sharedMetricsLayout.ts

/**
 * SharedArrayBuffer layout for performance metrics.
 *
 * This file mirrors the style of other shared layouts (input/engine/physics):
 * - Pure constants (MAGIC, VERSION, OFFSETS, SIZES)
 * - All OFFSETS are expressed in BYTES and are Int32-aligned where applicable
 * - No functions or classes; import these constants where SAB access is required
 *
 * Design:
 * - The render worker (writer) publishes a compact set of per-frame metrics into this SAB.
 * - The main thread (reader) periodically reads and displays metrics (HUD/UI).
 * - Fields are written as individual Int32 values (microseconds, counts, dimensions).
 *
 * Consistency model:
 * - There is no generation/lock here; instead, readers should:
 *     1) Read FRAME_ID (f0), then read all fields.
 *     2) Read FRAME_ID again (f1).
 *     3) If f0 !== f1, re-read once to get a consistent snapshot (see core/metrics.ts).
 *
 * Notes:
 * - Convert byte offsets to Int32Array indices with >> 2 when accessing.
 * - All values are Int32 (microseconds, counters, dimensions). Keep within signed 32-bit range.
 * - Writer is the render worker; reader is the main thread only.
 */

/* ==========================================================================================
 * Header (common)
 * Layout (bytes):
 *   [0]   MAGIC     (u32)  - 'METR'
 *   [4]   VERSION   (u32)
 * ======================================================================================== */

/** Shared performance metrics buffer layout (Int32-aligned offsets in BYTES) */
export const METRICS_MAGIC = 0x4d455452; // 'METR' ascii tag
export const METRICS_VERSION = 1;

/** Offsets (in bytes). All fields are Int32. */
export const METRICS_MAGIC_OFFSET = 0;
export const METRICS_VERSION_OFFSET = 4;

/* ==========================================================================================
 * Metrics fields (writer: render worker, reader: main)
 * Layout (bytes):
 *   [8]   FRAME_ID                 (i32)  - monotonic increasing per publish
 *   [12]  DT_US                    (i32)  - delta time (microseconds)
 *   [16]  CANVAS_W                 (i32)  - physical render width (px)
 *   [20]  CANVAS_H                 (i32)  - physical render height (px)
 *   [24]  LIGHT_COUNT              (i32)  - total lights in scene
 *   [28]  VISIBLE_OPAQUE           (i32)  - visible opaque objects
 *   [32]  VISIBLE_TRANSPARENT      (i32)  - visible transparent objects
 *   [36]  DRAW_CALLS_OPAQUE        (i32)  - draw calls (opaque)
 *   [40]  DRAW_CALLS_TRANSPARENT   (i32)  - draw calls (transparent)
 *   [44]  INSTANCES_OPAQUE         (i32)  - instance count (opaque)
 *   [48]  INSTANCES_TRANSPARENT    (i32)  - instance count (transparent)
 *   [52]  CPU_TOTAL_US             (i32)  - Renderer.render CPU wall time (microseconds)
 *   [56]  CLUSTER_AVG_LPC_X1000    (i32)  - avg lights per cluster * 1000 (fixed-point)
 *   [60]  CLUSTER_MAX_LPC          (i32)  - max lights per cluster
 *   [64]  CLUSTER_OVERFLOWS        (i32)  - total cluster overflows this frame
 * ======================================================================================== */

/** [2] FRAME_ID (monotonic increasing) */
export const METRICS_FRAME_ID_OFFSET = 8;
/** [3] DT_US (delta time in microseconds) */
export const METRICS_DT_US_OFFSET = 12;
/** [4] CANVAS_W (physical render width in pixels) */
export const METRICS_CANVAS_W_OFFSET = 16;
/** [5] CANVAS_H (physical render height in pixels) */
export const METRICS_CANVAS_H_OFFSET = 20;
/** [6] LIGHT_COUNT */
export const METRICS_LIGHT_COUNT_OFFSET = 24;
/** [7] VISIBLE_OPAQUE */
export const METRICS_VISIBLE_OPAQUE_OFFSET = 28;
/** [8] VISIBLE_TRANSPARENT */
export const METRICS_VISIBLE_TRANSPARENT_OFFSET = 32;
/** [9] DRAW_CALLS_OPAQUE */
export const METRICS_DRAW_CALLS_OPAQUE_OFFSET = 36;
/** [10] DRAW_CALLS_TRANSPARENT */
export const METRICS_DRAW_CALLS_TRANSPARENT_OFFSET = 40;
/** [11] INSTANCES_OPAQUE */
export const METRICS_INSTANCES_OPAQUE_OFFSET = 44;
/** [12] INSTANCES_TRANSPARENT */
export const METRICS_INSTANCES_TRANSPARENT_OFFSET = 48;
/** [13] CPU_TOTAL_US (Renderer.render CPU wall time in microseconds) */
export const METRICS_CPU_TOTAL_US_OFFSET = 52;
/** [14] CLUSTER_AVG_LPC_X1000 (average lights per cluster * 1000) */
export const METRICS_CLUSTER_AVG_X1000_OFFSET = 56;
/** [15] CLUSTER_MAX_LPC (max lights per cluster) */
export const METRICS_CLUSTER_MAX_OFFSET = 60;
/** [16] CLUSTER_OVERFLOWS (total overflows) */
export const METRICS_CLUSTER_OVERFLOWS_OFFSET = 64;

/* ==========================================================================================
 * Total buffer sizing
 * ======================================================================================== */

/**
 * Total buffer size (bytes).
 * 17 Int32 fields × 4 bytes = 68 bytes
 */
export const METRICS_BUFFER_SIZE = 68; // 17 Int32 fields * 4 bytes

/* ==========================================================================================
 * Usage Notes:
 * - All OFFSETS are in BYTES; convert to Int32 indices with >> 2.
 * - Writer (render worker):
 *     - Writes DT/size/counters for the frame
 *     - Atomics.store for all fields is sufficient (single-writer)
 *     - Updates FRAME_ID last to signal a new snapshot
 * - Reader (main thread):
 *     - Read FRAME_ID (f0), then all fields, then FRAME_ID again (f1)
 *     - If f0 !== f1, re-read once for coherence (see core/metrics.ts)
 * - Keep values within signed 32-bit ranges (ie microseconds clamp, counts).
 * ======================================================================================== */

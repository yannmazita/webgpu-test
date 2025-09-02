// src/core/sharedMetricsLayout.ts

// Shared performance metrics buffer layout (Int32-aligned offsets in BYTES)
export const METRICS_MAGIC = 0x4d455452; // 'METR' ascii tag
export const METRICS_VERSION = 1;

// Offsets (in bytes). All fields are Int32.
// [0] MAGIC
export const METRICS_MAGIC_OFFSET = 0;
// [1] VERSION
export const METRICS_VERSION_OFFSET = 4;
// [2] FRAME_ID (monotonic increasing)
export const METRICS_FRAME_ID_OFFSET = 8;
// [3] DT_US (delta time in microseconds)
export const METRICS_DT_US_OFFSET = 12;
// [4] CANVAS_W (physical render width in pixels)
export const METRICS_CANVAS_W_OFFSET = 16;
// [5] CANVAS_H (physical render height in pixels)
export const METRICS_CANVAS_H_OFFSET = 20;
// [6] LIGHT_COUNT
export const METRICS_LIGHT_COUNT_OFFSET = 24;
// [7] VISIBLE_OPAQUE
export const METRICS_VISIBLE_OPAQUE_OFFSET = 28;
// [8] VISIBLE_TRANSPARENT
export const METRICS_VISIBLE_TRANSPARENT_OFFSET = 32;
// [9] DRAW_CALLS_OPAQUE
export const METRICS_DRAW_CALLS_OPAQUE_OFFSET = 36;
// [10] DRAW_CALLS_TRANSPARENT
export const METRICS_DRAW_CALLS_TRANSPARENT_OFFSET = 40;
// [11] INSTANCES_OPAQUE
export const METRICS_INSTANCES_OPAQUE_OFFSET = 44;
// [12] INSTANCES_TRANSPARENT
export const METRICS_INSTANCES_TRANSPARENT_OFFSET = 48;
// [13] CPU_TOTAL_US (Renderer.render CPU wall time in microseconds)
export const METRICS_CPU_TOTAL_US_OFFSET = 52;

// Total buffer size (bytes)
export const METRICS_BUFFER_SIZE = 56; // 14 Int32 fields * 4 bytes

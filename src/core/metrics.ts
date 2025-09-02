import {
  METRICS_BUFFER_SIZE,
  METRICS_MAGIC,
  METRICS_MAGIC_OFFSET,
  METRICS_VERSION,
  METRICS_VERSION_OFFSET,
  METRICS_FRAME_ID_OFFSET,
  METRICS_DT_US_OFFSET,
  METRICS_CANVAS_W_OFFSET,
  METRICS_CANVAS_H_OFFSET,
  METRICS_LIGHT_COUNT_OFFSET,
  METRICS_VISIBLE_OPAQUE_OFFSET,
  METRICS_VISIBLE_TRANSPARENT_OFFSET,
  METRICS_DRAW_CALLS_OPAQUE_OFFSET,
  METRICS_DRAW_CALLS_TRANSPARENT_OFFSET,
  METRICS_INSTANCES_OPAQUE_OFFSET,
  METRICS_INSTANCES_TRANSPARENT_OFFSET,
  METRICS_CPU_TOTAL_US_OFFSET,
} from "./sharedMetricsLayout";
import { RendererStats } from "./renderer";

export type { RendererStats };

// The context object holding the view for the metrics buffer.
export interface MetricsContext {
  view: Int32Array;
}

// A read-only snapshot of the metrics from the shared buffer.
export interface MetricsSnapshot {
  frameId: number;
  dtUs: number;
  w: number;
  h: number;
  lights: number;
  visOpaque: number;
  visTransp: number;
  drawsOpaque: number;
  drawsTransp: number;
  instOpaque: number;
  instTransp: number;
  cpuUs: number;
}

/**
 * Creates a context for the metrics buffer and initializes its header.
 * Should be called once per thread.
 * @param buffer The SharedArrayBuffer for metrics.
 */
export function createMetricsContext(
  buffer: SharedArrayBuffer,
): MetricsContext {
  if (buffer.byteLength !== METRICS_BUFFER_SIZE) {
    throw new Error("Invalid metrics buffer size");
  }
  return { view: new Int32Array(buffer) };
}

/**
 * Initializes the header of the metrics buffer.
 * Should only be called by the writer thread.
 */
export function initializeMetrics(context: MetricsContext): void {
  Atomics.store(context.view, METRICS_MAGIC_OFFSET >> 2, METRICS_MAGIC);
  Atomics.store(context.view, METRICS_VERSION_OFFSET >> 2, METRICS_VERSION);
}

/**
 * Writes a complete snapshot of metrics to the shared buffer. (Worker)
 * @param context The metrics context.
 * @param stats The latest stats from the renderer.
 * @param dtSeconds The delta time for the frame.
 * @param frameId The current frame counter.
 */
export function publishMetrics(
  context: MetricsContext,
  stats: RendererStats,
  dtSeconds: number,
  frameId: number,
): void {
  const idx = (byteOffset: number) => byteOffset >> 2;
  const dtUs = Math.max(
    0,
    Math.min(0x7fffffff, Math.round(dtSeconds * 1_000_000)),
  );

  Atomics.store(context.view, idx(METRICS_FRAME_ID_OFFSET), frameId);
  Atomics.store(context.view, idx(METRICS_DT_US_OFFSET), dtUs);
  Atomics.store(context.view, idx(METRICS_CANVAS_W_OFFSET), stats.canvasWidth);
  Atomics.store(context.view, idx(METRICS_CANVAS_H_OFFSET), stats.canvasHeight);
  Atomics.store(
    context.view,
    idx(METRICS_LIGHT_COUNT_OFFSET),
    stats.lightCount,
  );
  Atomics.store(
    context.view,
    idx(METRICS_VISIBLE_OPAQUE_OFFSET),
    stats.visibleOpaque,
  );
  Atomics.store(
    context.view,
    idx(METRICS_VISIBLE_TRANSPARENT_OFFSET),
    stats.visibleTransparent,
  );
  Atomics.store(
    context.view,
    idx(METRICS_DRAW_CALLS_OPAQUE_OFFSET),
    stats.drawsOpaque,
  );
  Atomics.store(
    context.view,
    idx(METRICS_DRAW_CALLS_TRANSPARENT_OFFSET),
    stats.drawsTransparent,
  );
  Atomics.store(
    context.view,
    idx(METRICS_INSTANCES_OPAQUE_OFFSET),
    stats.instancesOpaque,
  );
  Atomics.store(
    context.view,
    idx(METRICS_INSTANCES_TRANSPARENT_OFFSET),
    stats.instancesTransparent,
  );
  Atomics.store(
    context.view,
    idx(METRICS_CPU_TOTAL_US_OFFSET),
    stats.cpuTotalUs,
  );
}

/**
 * Reads a consistent snapshot of all metrics. (Main Thread)
 * @param context The metrics context.
 */
export function readMetricsSnapshot(context: MetricsContext): MetricsSnapshot {
  const readOnce = (): { ok: boolean; snapshot: MetricsSnapshot } => {
    const idx = (byteOffset: number) => byteOffset >> 2;
    const f0 = Atomics.load(context.view, idx(METRICS_FRAME_ID_OFFSET));

    const snapshot: MetricsSnapshot = {
      dtUs: Atomics.load(context.view, idx(METRICS_DT_US_OFFSET)),
      w: Atomics.load(context.view, idx(METRICS_CANVAS_W_OFFSET)),
      h: Atomics.load(context.view, idx(METRICS_CANVAS_H_OFFSET)),
      lights: Atomics.load(context.view, idx(METRICS_LIGHT_COUNT_OFFSET)),
      visOpaque: Atomics.load(context.view, idx(METRICS_VISIBLE_OPAQUE_OFFSET)),
      visTransp: Atomics.load(
        context.view,
        idx(METRICS_VISIBLE_TRANSPARENT_OFFSET),
      ),
      drawsOpaque: Atomics.load(
        context.view,
        idx(METRICS_DRAW_CALLS_OPAQUE_OFFSET),
      ),
      drawsTransp: Atomics.load(
        context.view,
        idx(METRICS_DRAW_CALLS_TRANSPARENT_OFFSET),
      ),
      instOpaque: Atomics.load(
        context.view,
        idx(METRICS_INSTANCES_OPAQUE_OFFSET),
      ),
      instTransp: Atomics.load(
        context.view,
        idx(METRICS_INSTANCES_TRANSPARENT_OFFSET),
      ),
      cpuUs: Atomics.load(context.view, idx(METRICS_CPU_TOTAL_US_OFFSET)),
      frameId: 0,
    };

    const f1 = Atomics.load(context.view, idx(METRICS_FRAME_ID_OFFSET));
    snapshot.frameId = f1;
    return { ok: f0 === f1, snapshot };
  };

  const result = readOnce();
  if (result.ok) return result.snapshot;
  return readOnce().snapshot; // Retry once
}

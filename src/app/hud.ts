// src/app/hud.ts
import { MetricsContext, readMetricsSnapshot } from "@/core/metrics";

let hud: HTMLDivElement;
let metricsContext: MetricsContext;

const HUD_UPDATE_INTERVAL_MS = 250;
let lastHudUpdateTime = 0;
let lastHudFrameId = 0;

/**
 * Initializes the HUD module.
 * @param hudElement The HTMLDivElement to display the HUD text in.
 * @param metCtx The metrics context for reading performance data.
 */
export function init(
  hudElement: HTMLDivElement,
  metCtx: MetricsContext,
): void {
  hud = hudElement;
  metricsContext = metCtx;
  hud.textContent = "Initializing...";
}

/**
 * Updates the HUD with the latest metrics from the shared buffer.
 * This function is throttled to avoid excessive DOM updates.
 * @param nowMs The current timestamp.
 * @param isPointerLocked The current pointer lock state.
 */
export function update(nowMs: number, isPointerLocked: boolean): void {
  if (nowMs - lastHudUpdateTime < HUD_UPDATE_INTERVAL_MS) return;

  const m = readMetricsSnapshot(metricsContext);
  if (m.frameId === 0 || m.frameId === lastHudFrameId) {
    lastHudUpdateTime = nowMs;
    return;
  }
  lastHudFrameId = m.frameId;

  const fps = m.dtUs > 0 ? 1_000_000 / m.dtUs : 0;
  const cpuMs = m.cpuUs / 1000;

  const avgL = (m.clusterAvgX1000 ?? 0) / 1000;
  const maxL = m.clusterMax ?? 0;
  const ofl = m.clusterOverflows ?? 0;

  hud.textContent =
    `FPS: ${fps.toFixed(1)}  |  CPU(ms): ${cpuMs.toFixed(2)}  |  Frame: ${m.frameId}\n` +
    `Canvas: ${m.w}x${m.h}  |  Lights: ${m.lights}\n` +
    `Visible (O/T): ${m.visOpaque}/${m.visTransp}\n` +
    `Draws (O/T): ${m.drawsOpaque}/${m.drawsTransp}\n` +
    `Instances (O/T): ${m.instOpaque}/${m.instTransp}\n` +
    `Cluster L/cluster avg/max: ${avgL.toFixed(2)}/${maxL}  |  Overflows: ${ofl}\n` +
    `Pointer Lock: ${isPointerLocked ? "ON" : "OFF"} (Press ESC to exit, C to toggle camera)`;

  lastHudUpdateTime = nowMs;
}

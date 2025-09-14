// src/app/main.ts
import "@/style.css";
import { SHARED_BUFFER_SIZE } from "@/core/sharedInputLayout";
import { METRICS_BUFFER_SIZE } from "@/core/sharedMetricsLayout";
import { createMetricsContext, readMetricsSnapshot } from "@/core/metrics";
import {
  createInputContext,
  updateKeyState,
  accumulateMouseDelta,
  updateMousePosition,
  updatePointerLock,
} from "@/core/input";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) throw new Error("Canvas element not found");

// Setup shared memory and contexts
const inputBuffer = new SharedArrayBuffer(SHARED_BUFFER_SIZE);
const inputContext = createInputContext(inputBuffer);

const metricsBuffer = new SharedArrayBuffer(METRICS_BUFFER_SIZE);
const metricsContext = createMetricsContext(metricsBuffer);

// --- Input Event Handling ---
let isPointerLockedState = false;
let mouseX = 0;
let mouseY = 0;

const handleKeyDown = (e: KeyboardEvent): void => {
  updateKeyState(inputContext, e.code, true);
};
const handleKeyUp = (e: KeyboardEvent): void => {
  updateKeyState(inputContext, e.code, false);
};
const handleCanvasClick = async (): Promise<void> => {
  if (!isPointerLockedState) {
    await canvas.requestPointerLock();
  }
};
const handlePointerLockChange = (): void => {
  isPointerLockedState = document.pointerLockElement === canvas;
  updatePointerLock(inputContext, isPointerLockedState);

  if (isPointerLockedState) {
    const w = canvas.clientWidth || 0;
    const h = canvas.clientHeight || 0;
    mouseX = Math.max(0, Math.floor(w * 0.5));
    mouseY = Math.max(0, Math.floor(h * 0.5));
    updateMousePosition(inputContext, mouseX, mouseY);
  }
};
const handleMouseMove = (e: MouseEvent): void => {
  const w = canvas.clientWidth || 0;
  const h = canvas.clientHeight || 0;

  if (isPointerLockedState) {
    accumulateMouseDelta(inputContext, e.movementX, e.movementY);
    mouseX = Math.min(Math.max(mouseX + e.movementX, 0), Math.max(0, w - 1));
    mouseY = Math.min(Math.max(mouseY + e.movementY, 0), Math.max(0, h - 1));
  } else {
    const rect = canvas.getBoundingClientRect();
    mouseX = Math.min(
      Math.max(Math.floor(e.clientX - rect.left), 0),
      Math.max(0, w - 1),
    );
    mouseY = Math.min(
      Math.max(Math.floor(e.clientY - rect.top), 0),
      Math.max(0, h - 1),
    );
  }
  updateMousePosition(inputContext, mouseX, mouseY);
};

document.addEventListener("keydown", handleKeyDown);
document.addEventListener("keyup", handleKeyUp);
document.addEventListener("pointerlockchange", handlePointerLockChange);
canvas.addEventListener("click", handleCanvasClick); // eslint-disable-line
document.addEventListener("mousemove", handleMouseMove);

// --- HUD Setup ---
const hud = document.createElement("div");
hud.id = "hud";
hud.textContent = "Initializing...";
document.body.appendChild(hud);

const HUD_UPDATE_INTERVAL_MS = 250;
let lastHudUpdateTime = 0;
let lastHudFrameId = 0;

const updateHud = (nowMs: number) => {
  // Limit DOM updates to the target HUD frequency
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
    `Cluster L/cluster avg/max: ${avgL.toFixed(2)}/${maxL}  |  Overflows: ${ofl}`;

  lastHudUpdateTime = nowMs;
};

// --- Worker Setup ---
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
const offscreen = canvas.transferControlToOffscreen();
worker.postMessage(
  {
    type: "INIT",
    canvas: offscreen,
    sharedInputBuffer: inputBuffer,
    sharedMetricsBuffer: metricsBuffer,
  },
  [offscreen],
);

// Frame-driven resize polling
let lastCssW = 0;
let lastCssH = 0;
let dpr = window.devicePixelRatio || 1;

const sendResize = () => {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const currDpr = window.devicePixelRatio || 1;

  // Don't send a resize message if the canvas isn't laid out yet
  if (w === 0 || h === 0) {
    return;
  }

  if (w !== lastCssW || h !== lastCssH || currDpr !== dpr) {
    lastCssW = w;
    lastCssH = h;
    dpr = currDpr;
    worker.postMessage({
      type: "RESIZE",
      cssWidth: w,
      cssHeight: h,
      devicePixelRatio: dpr,
    });
  }
};

// Listen for worker acks
let canSendFrame = false;
worker.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || !msg.type) return;

  if (msg.type === "READY") {
    // Worker finished initialization; allow first frame
    canSendFrame = true;
    return;
  }

  if (msg.type === "FRAME_DONE") {
    // Worker finished the last frame; allow next
    canSendFrame = true;
    return;
  }
});

const tick = (now: number) => {
  // Always check for resize at the start of a frame.
  // sendResize() is cheap and only posts a message when dimensions change.
  sendResize();

  if (canSendFrame) {
    canSendFrame = false;
    // The FRAME message is just a timing signal.
    // All input data is read directly by the worker from shared memory.
    worker.postMessage({
      type: "FRAME",
      now,
    });
  }
  updateHud(now);
  requestAnimationFrame(tick);
};

requestAnimationFrame(tick);

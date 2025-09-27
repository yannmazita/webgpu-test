// src/app/main.ts
import "@/style.css";
import { SHARED_BUFFER_SIZE } from "@/core/sharedInputLayout";
import { METRICS_BUFFER_SIZE } from "@/core/sharedMetricsLayout";
import { createMetricsContext } from "@/core/metrics";
import { createInputContext } from "@/core/input/manager";
import { SHARED_ENGINE_STATE_BUFFER_SIZE } from "@/core/sharedEngineStateLayout";
import {
  createEngineStateContext as createEngineStateCtx,
  initializeEngineStateHeader,
} from "@/core/engineState";
import { init as initUIElements, initUI, tickUI } from "./ui";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) throw new Error("Canvas element not found");

const uiCanvas = document.querySelector<HTMLCanvasElement>("#ui-canvas");
if (!uiCanvas) throw new Error("UI Canvas element not found");

const hud = document.querySelector<HTMLDivElement>("#hud");
if (!hud) throw new Error("HUD element not found");

// Setup shared memory and contexts
const inputBuffer = new SharedArrayBuffer(SHARED_BUFFER_SIZE);
const inputContext = createInputContext(inputBuffer, true);

const metricsBuffer = new SharedArrayBuffer(METRICS_BUFFER_SIZE);
const metricsContext = createMetricsContext(metricsBuffer);

const engineStateBuffer = new SharedArrayBuffer(
  SHARED_ENGINE_STATE_BUFFER_SIZE,
);
const engineStateCtx = createEngineStateCtx(engineStateBuffer);
initializeEngineStateHeader(engineStateCtx);

// --- Render Worker Setup ---
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});

initUIElements(
  canvas,
  uiCanvas,
  hud,
  inputContext,
  metricsContext,
  engineStateCtx,
  worker,
);

const offscreen = canvas.transferControlToOffscreen();
worker.postMessage(
  {
    type: "INIT",
    canvas: offscreen,
    sharedInputBuffer: inputBuffer,
    sharedMetricsBuffer: metricsBuffer,
    sharedEngineStateBuffer: engineStateBuffer,
  },
  [offscreen],
);

// event-driven resize handling with RAF throttling
let lastCssW = 0;
let lastCssH = 0;
let dpr = window.devicePixelRatio || 1;

// Track latest pending size; only send once per animation frame.
let pendingResizeRaf: number | null = null;
let pendingW = 0;
let pendingH = 0;
let pendingDpr = dpr;

const sendResize = (w: number, h: number, currDpr: number) => {
  if (w <= 0 || h <= 0) return;
  if (w === lastCssW && h === lastCssH && currDpr === dpr) return;

  lastCssW = w;
  lastCssH = h;
  dpr = currDpr;

  worker.postMessage({
    type: "RESIZE",
    cssWidth: w,
    cssHeight: h,
    devicePixelRatio: dpr,
  });
};

// Batch multiple size changes into one post per animation frame.
const scheduleResize = (w: number, h: number, currDpr: number) => {
  pendingW = w;
  pendingH = h;
  pendingDpr = currDpr;
  if (pendingResizeRaf != null) return;
  pendingResizeRaf = requestAnimationFrame(() => {
    pendingResizeRaf = null;
    sendResize(pendingW, pendingH, pendingDpr);
  });
};

// Observe CSS size changes of the DOM canvas.
const resizeObserver = new ResizeObserver(() => {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const currDpr = window.devicePixelRatio || 1;
  scheduleResize(w, h, currDpr);
});
resizeObserver.observe(canvas);

// Ensure we send a correct first RESIZE after layout has occurred.
requestAnimationFrame(() => {
  // Double RAF to ensure layout is complete
  requestAnimationFrame(() => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const currDpr = window.devicePixelRatio || 1;

    // Send initial resize immediately if we have valid dimensions
    if (w > 0 && h > 0) {
      console.log(`[Main] Sending initial resize: ${w}x${h} @ ${currDpr}x`);
      sendResize(w, h, currDpr);
    } else {
      console.warn(
        "[Main] Canvas has invalid initial dimensions, waiting for resize",
      );
    }
  });
});

// Also catch DPR/visibility changes that might not trigger ResizeObserver immediately.
window.addEventListener("resize", () => {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const currDpr = window.devicePixelRatio || 1;
  scheduleResize(w, h, currDpr);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const currDpr = window.devicePixelRatio || 1;
    scheduleResize(w, h, currDpr);
  }
});

interface WorkerMessage {
  type: string;
}

// Listen for worker acks
let canSendFrame = false;
worker.addEventListener("message", (ev: MessageEvent<WorkerMessage>) => {
  const msg = ev.data;
  if (!msg?.type) return;

  if (msg.type === "READY") {
    isWorkerReady = true;
    canSendFrame = true;
    console.log("[Main] Worker ready, starting render loop");
    return;
  }

  if (msg.type === "FRAME_DONE") {
    canSendFrame = true;
    return;
  }
});

let isWorkerReady = false;
const tick = (now: number) => {
  if (isWorkerReady && canSendFrame) {
    canSendFrame = false;
    // The FRAME message is just a timing signal.
    // All input data is read directly by the worker from shared memory.
    worker.postMessage({
      type: "FRAME",
      now,
    });
  }
  tickUI(now);
  requestAnimationFrame(tick);
};

await initUI();
requestAnimationFrame(tick);

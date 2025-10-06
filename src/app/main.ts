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

// --- Physics Communication Setup ---
const { RAYCAST_RESULTS_BUFFER_SIZE } = await import(
  "@/core/sharedPhysicsLayout"
);
const raycastResultsBuffer = new SharedArrayBuffer(RAYCAST_RESULTS_BUFFER_SIZE);

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
    sharedRaycastResultsBuffer: raycastResultsBuffer,
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
sendResize();

interface WorkerMessage {
  type: string;
}

// Listen for worker acks
let canSendFrame = false;
worker.addEventListener("message", (ev: MessageEvent<WorkerMessage>) => {
  const msg = ev.data;
  if (!msg?.type) return;

  if (msg.type === "READY") {
    canSendFrame = true;
    return;
  }

  if (msg.type === "FRAME_DONE") {
    canSendFrame = true;
    return;
  }
});

const tick = (now: number) => {
  // Always check for resize at the start of a frame.
  // todo: refactor resizing (dumpster fire performance)
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
  tickUI(now);
  requestAnimationFrame(tick);
};

await initUI();
requestAnimationFrame(tick);

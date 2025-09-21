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
import {
  COMMANDS_BUFFER_SIZE,
  STATES_BUFFER_SIZE,
  CMD_CREATE_BODY,
} from "@/core/sharedPhysicsLayout";
import {
  createPhysicsContext,
  initializePhysicsHeaders,
  tryEnqueueCommand,
} from "@/core/physicsState";

import type {
  PhysicsInitMsg,
  PhysicsStepMsg,
  PhysicsDestroyMsg,
} from "@/core/types/physics";

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

// --- Physics Worker Setup ---
const commandsBuffer = new SharedArrayBuffer(COMMANDS_BUFFER_SIZE);
const statesBuffer = new SharedArrayBuffer(STATES_BUFFER_SIZE);

// Initialize physics SAB headers (writer-side init for consistency)
const physCtx = createPhysicsContext(commandsBuffer, statesBuffer);
initializePhysicsHeaders(physCtx);

// Enqueue a single dummy CREATE_BODY command for the physics worker to consume
// This triggers the worker's dummy world (ground + falling sphere)
tryEnqueueCommand(physCtx, CMD_CREATE_BODY, 0, []);

// Create physics worker
const physicsWorker = new Worker(
  new URL("./physicsWorker.ts", import.meta.url),
  {
    type: "module",
  },
);

let physicsReady = false;
physicsWorker.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || !msg.type) return;

  if (msg.type === "READY") {
    physicsReady = true;
    console.log("[Main] Physics worker ready.");
    // Test: Send 10 fixed steps after init
    physicsWorker.postMessage({ type: "STEP", steps: 10 } as PhysicsStepMsg);
    return;
  }
  if (msg.type === "STEP_DONE") {
    console.log("[Main] Physics test complete:", msg.log);
    return;
  }
  if (msg.type === "ERROR") {
    console.error("[Main] Physics worker error:", msg.error);
    return;
  }
  if (msg.type === "DESTROYED") {
    console.log("[Main] Physics worker destroyed.");
    return;
  }
});

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

// Listen for worker acks and hook physics init to render READY
let canSendFrame = false;
worker.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || !msg.type) return;

  if (msg.type === "READY") {
    // Initialize physics after render worker is ready
    const initMsg: PhysicsInitMsg = {
      type: "INIT",
      commandsBuffer,
      statesBuffer,
    };
    // SABs are shared; no transfer list
    physicsWorker.postMessage(initMsg);
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

// Cleanup on unload
window.addEventListener("beforeunload", () => {
  physicsWorker.postMessage({ type: "DESTROY" } as PhysicsDestroyMsg);
  physicsWorker.terminate();
});

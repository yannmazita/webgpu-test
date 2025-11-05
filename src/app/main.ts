// src/app/main.ts
import "@/style.css";
import { MAX_GAMEPADS, SHARED_BUFFER_SIZE } from "@/core/sharedInputLayout";
import {
  clearGamepadState,
  createInputContext,
  updateGamepadState,
} from "@/core/input/manager";
import { SHARED_ENGINE_STATE_BUFFER_SIZE } from "@/core/sharedEngineStateLayout";
import {
  createEngineStateContext as createEngineStateCtx,
  initializeEngineStateHeader,
} from "@/core/engineState";
import {
  init as initEditor,
  initGPU as initEditorGPU,
  update as tickUI,
} from "@/app/editor";
import {
  CHAR_CONTROLLER_EVENTS_BUFFER_SIZE,
  INTERACTION_RAYCAST_RESULTS_BUFFER_SIZE,
} from "@/core/sharedPhysicsLayout";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) throw new Error("Canvas element not found");

const uiCanvas = document.querySelector<HTMLCanvasElement>("#ui-canvas");
if (!uiCanvas) throw new Error("UI Canvas element not found");

// Setup shared memory and contexts
const inputBuffer = new SharedArrayBuffer(SHARED_BUFFER_SIZE);
const inputContext = createInputContext(inputBuffer, true);

const engineStateBuffer = new SharedArrayBuffer(
  SHARED_ENGINE_STATE_BUFFER_SIZE,
);
const engineStateCtx = createEngineStateCtx(engineStateBuffer);
initializeEngineStateHeader(engineStateCtx);

// --- Physics Communication Setup ---
const { RAYCAST_RESULTS_BUFFER_SIZE, COLLISION_EVENTS_BUFFER_SIZE } =
  await import("@/core/sharedPhysicsLayout");
const raycastResultsBuffer = new SharedArrayBuffer(RAYCAST_RESULTS_BUFFER_SIZE);
const collisionEventsBuffer = new SharedArrayBuffer(
  COLLISION_EVENTS_BUFFER_SIZE,
);
const interactionRaycastResultsBuffer = new SharedArrayBuffer(
  INTERACTION_RAYCAST_RESULTS_BUFFER_SIZE,
);
const charControllerEventsBuffer = new SharedArrayBuffer(
  CHAR_CONTROLLER_EVENTS_BUFFER_SIZE,
);

// --- Render Worker Setup ---
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});

initEditor(canvas, uiCanvas, inputContext, engineStateCtx, worker);

const offscreen = canvas.transferControlToOffscreen();
worker.postMessage(
  {
    type: "INIT",
    canvas: offscreen,
    sharedInputBuffer: inputBuffer,
    sharedEngineStateBuffer: engineStateBuffer,
    sharedRaycastResultsBuffer: raycastResultsBuffer,
    sharedCollisionEventsBuffer: collisionEventsBuffer,
    sharedInteractionRaycastResultsBuffer: interactionRaycastResultsBuffer,
    sharedCharControllerEventsBuffer: charControllerEventsBuffer,
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

const pollGamepads = () => {
  const gamepads = navigator.getGamepads();
  const connectedPads = new Set<number>();

  for (const gamepad of gamepads) {
    if (gamepad) {
      connectedPads.add(gamepad.index);
      let buttonMask = 0;
      gamepad.buttons.forEach((button, index) => {
        if (button.pressed) {
          buttonMask |= 1 << index;
        }
      });
      updateGamepadState(inputContext, gamepad.index, buttonMask, gamepad.axes);
    }
  }

  // Clear state for disconnected pads
  for (let i = 0; i < MAX_GAMEPADS; i++) {
    if (!connectedPads.has(i)) {
      clearGamepadState(inputContext, i);
    }
  }
};

const tick = (now: number) => {
  // Always check for resize at the start of a frame.
  // todo: refactor resizing (dumpster fire performance - (only on firefox apparently))
  // todo2: don't do on-the-fly resize, app (via UI) should be setting render and window (canvas) resolution
  // todo3: actually do it it's ridiculous
  sendResize();

  // Poll gamepads and update shared buffer
  pollGamepads();

  if (canSendFrame) {
    canSendFrame = false;
    // The FRAME message is just a timing signal.
    // All input data is read directly by the worker from shared memory.
    worker.postMessage({
      type: "FRAME",
      now,
    });
  }
  tickUI();
  requestAnimationFrame(tick);
};

await initEditorGPU();
requestAnimationFrame(tick);

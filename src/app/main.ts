// src/app/main.ts
import "@/style.css";
import { InputManager } from "@/core/inputManager";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) throw new Error("Canvas element not found");

// Setup input on main thread. This now creates the SharedArrayBuffer.
const input = new InputManager(canvas);

// Create worker and transfer canvas and the shared buffer.
// The buffer is NOT in the transferable list, as it's meant to be shared.
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
const offscreen = (
  canvas as any
).transferControlToOffscreen() as OffscreenCanvas;
worker.postMessage(
  {
    type: "INIT",
    canvas: offscreen,
    sharedInputBuffer: input.sharedBuffer,
  },
  [offscreen as any],
);

// Event-driven resize messages
let lastCssW = 0;
let lastCssH = 0;
let dpr = window.devicePixelRatio || 1;

const sendResize = () => {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const currDpr = window.devicePixelRatio || 1;
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

// Initial and observed resize
const ro = new ResizeObserver(() => sendResize());
ro.observe(canvas);
window.addEventListener("resize", sendResize);
sendResize();

// Listen for worker acks
let canSendFrame = false;
worker.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || !msg.type) return;

  if (msg.type === "READY") {
    // Worker finished initialization; allow first frame
    canSendFrame = true;
    // Send a resize in case one hasn't been sent yet
    sendResize();
    return;
  }

  if (msg.type === "FRAME_DONE") {
    // Worker finished the last frame; allow next
    canSendFrame = true;
    return;
  }
});

const tick = (now: number) => {
  if (canSendFrame) {
    canSendFrame = false;
    // The FRAME message is now just a timing signal.
    // All input data is read directly by the worker from shared memory.
    worker.postMessage({
      type: "FRAME",
      now,
    });
    // Reset mouse delta in the shared buffer for the next frame.
    input.lateUpdate();
  }

  requestAnimationFrame(tick);
};

requestAnimationFrame(tick);

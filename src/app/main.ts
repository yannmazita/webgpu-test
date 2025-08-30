// src/app/main.ts
import "@/style.css";
import { InputManager } from "@/core/inputManager";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) throw new Error("Canvas element not found");

// Create worker and transfer canvas
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
const offscreen = (
  canvas as any
).transferControlToOffscreen() as OffscreenCanvas;
worker.postMessage({ type: "INIT", canvas: offscreen }, [offscreen as any]);

// Setup input on main thread and forward to worker
const input = new InputManager(canvas);

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
    worker.postMessage({
      type: "FRAME",
      now,
      // bundled input snapshot
      keys: Array.from(input.keys),
      mouseDeltaX: input.mouseDelta.x,
      mouseDeltaY: input.mouseDelta.y,
      isPointerLocked: input.isPointerLocked,
    });
    input.lateUpdate();
  }

  requestAnimationFrame(tick);
};

requestAnimationFrame(tick);

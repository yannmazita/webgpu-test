// src/app/editor.ts
import { ImGui } from "@mori2003/jsimgui";
import { beginDebugUIFrame, endDebugUI, initDebugUI } from "@/core/debugUI";
import {
  readSnapshot as readEngineSnapshot,
  EngineStateContext,
} from "@/core/engineState";
import {
  InputContext,
  updateKeyState,
  accumulateMouseDelta,
  updateMousePosition,
  updatePointerLock,
} from "@/core/input/manager";

import { FogWidget } from "./editor-widgets/fogWidget";
import { SunWidget } from "./editor-widgets/sunWidget";
import { ShadowWidget } from "./editor-widgets/shadowWidget";
import { RenderingWidget } from "./editor-widgets/renderingWidget";
import { IblWidget } from "./editor-widgets/iblWidget";

let uiDevice: GPUDevice;
let uiContext: GPUCanvasContext;
let canvas: HTMLCanvasElement;
let uiCanvas: HTMLCanvasElement;
let inputContext: InputContext;
let engineStateCtx: EngineStateContext;
let worker: Worker;

// Widget instances
let fogWidget: FogWidget;
let sunWidget: SunWidget;
let shadowWidget: ShadowWidget;
let renderingWidget: RenderingWidget;
let iblWidget: IblWidget;

let isPointerLockedState = false;
let mouseX = 0;
let mouseY = 0;

let engineReady = false;

export function init(
  mainCanvas: HTMLCanvasElement,
  uiCanvasElement: HTMLCanvasElement,
  inCtx: InputContext,
  engStateCtx: EngineStateContext,
  w: Worker,
) {
  canvas = mainCanvas;
  uiCanvas = uiCanvasElement;
  inputContext = inCtx;
  engineStateCtx = engStateCtx;
  worker = w;

  // Instantiate widgets
  fogWidget = new FogWidget(engineStateCtx);
  sunWidget = new SunWidget(engineStateCtx);
  shadowWidget = new ShadowWidget(engineStateCtx);
  renderingWidget = new RenderingWidget(worker);
  iblWidget = new IblWidget(worker);

  worker.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (msg?.type === "READY") {
      const snapshot = readEngineSnapshot(engineStateCtx);

      // Update all widgets from the initial engine state
      fogWidget.updateFromEngineSnapshot(snapshot);
      sunWidget.updateFromEngineSnapshot(snapshot);
      shadowWidget.updateFromEngineSnapshot(snapshot);
      renderingWidget.updateFromEngineSnapshot(snapshot);
      iblWidget.updateFromEngineSnapshot(snapshot);

      engineReady = true;
    }
  });

  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("pointerlockchange", handlePointerLockChange);
  canvas.addEventListener("click", handleCanvasClick);
  uiCanvas.addEventListener("click", handleUICanvasClick);
}

export async function initGPU() {
  if (!navigator.gpu) throw new Error("WebGPU not supported");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No adapter found");
  uiDevice = await adapter.requestDevice();

  uiContext = uiCanvas.getContext("webgpu") as GPUCanvasContext;
  if (!uiContext) throw new Error("Failed to get WebGPU context");

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  uiContext.configure({
    device: uiDevice,
    format: presentationFormat,
    alphaMode: "premultiplied",
  });

  await initDebugUI(uiCanvas, uiDevice);

  const io = ImGui.GetIO();
  io.ConfigFlags |= ImGui.ConfigFlags.NavEnableKeyboard;
  io.ConfigFlags |= ImGui.ConfigFlags.DockingEnable;

  updateUICanvasInteractivity();
}

export function getPointerLockState(): boolean {
  return isPointerLockedState;
}

function updateUICanvasInteractivity(): void {
  if (!isPointerLockedState) {
    uiCanvas.style.pointerEvents = "auto";
    return;
  }
  const io = ImGui.GetIO();
  uiCanvas.style.pointerEvents = io.WantCaptureMouse ? "auto" : "none";
}

function handleKeyDown(e: KeyboardEvent): void {
  updateKeyState(inputContext, e.code, true);
  if (e.code === "Escape" && isPointerLockedState) {
    document.exitPointerLock();
    setTimeout(updateUICanvasInteractivity, 0);
  }
}

function handleKeyUp(e: KeyboardEvent): void {
  updateKeyState(inputContext, e.code, false);
}

async function handleCanvasClick(e: MouseEvent): Promise<void> {
  const io = ImGui.GetIO();
  if (io.WantCaptureMouse) return;
  if (e.target === canvas && !isPointerLockedState) {
    await canvas.requestPointerLock();
  }
}

async function handleUICanvasClick(e: MouseEvent): Promise<void> {
  const io = ImGui.GetIO();
  if (isPointerLockedState) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!io.WantCaptureMouse) {
    e.preventDefault();
    e.stopPropagation();
    await canvas.requestPointerLock();
  }
}

function handlePointerLockChange(): void {
  isPointerLockedState = document.pointerLockElement === canvas;
  updatePointerLock(inputContext, isPointerLockedState);
  if (isPointerLockedState) {
    const w = canvas.clientWidth || 0;
    const h = canvas.clientHeight || 0;
    mouseX = Math.max(0, Math.floor(w * 0.5));
    mouseY = Math.max(0, Math.floor(h * 0.5));
    updateMousePosition(inputContext, mouseX, mouseY);
  }
  updateUICanvasInteractivity();
}

function handleMouseMove(e: MouseEvent): void {
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
}

export function update(): void {
  if (!uiDevice || !uiContext) return;

  beginDebugUIFrame(uiCanvas);

  ImGui.Begin("Editor");
  ImGui.Separator();
  ImGui.Text(`Pointer Lock: ${isPointerLockedState ? "ON" : "OFF"}`);
  ImGui.Text("Press ESC to exit pointer lock");
  ImGui.Text("Press C to toggle camera mode");
  const io = ImGui.GetIO();
  ImGui.Text(`ImGui WantCaptureMouse: ${io.WantCaptureMouse}`);
  ImGui.Text(`ImGui WantCaptureKeyboard: ${io.WantCaptureKeyboard}`);
  ImGui.Separator();

  // Render all widgets
  fogWidget.render(engineReady);
  sunWidget.render(engineReady);
  shadowWidget.render(engineReady);
  renderingWidget.render();
  iblWidget.render();

  ImGui.End();
  updateUICanvasInteractivity();

  const uiCommandEncoder = uiDevice.createCommandEncoder();
  const textureView = uiContext.getCurrentTexture().createView();
  const uiPassEncoder = uiCommandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: textureView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      },
    ],
  });
  endDebugUI(uiPassEncoder);
  uiPassEncoder.end();
  uiDevice.queue.submit([uiCommandEncoder.finish()]);
}

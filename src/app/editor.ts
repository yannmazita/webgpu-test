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

import * as fogWidget from "./editor-widgets/fogWidget";
import * as sunWidget from "./editor-widgets/sunWidget";
import * as shadowWidget from "./editor-widgets/shadowWidget";
import * as renderingWidget from "./editor-widgets/renderingWidget";
import * as iblWidget from "./editor-widgets/iblWidget";

let uiDevice: GPUDevice;
let uiContext: GPUCanvasContext;
let canvas: HTMLCanvasElement;
let uiCanvas: HTMLCanvasElement;
let inputContext: InputContext;
let engineStateCtx: EngineStateContext;
let worker: Worker;

let isPointerLockedState = false;
let mouseX = 0;
let mouseY = 0;

const uiState = {
  fogEnabledUI: true,
  fogColorUI: [0.5, 0.6, 0.7] as [number, number, number],
  fogDensityUI: 0.02,
  fogHeightUI: 0.0,
  fogFalloffUI: 0.1,
  fogInscatterUI: 0.8,
  sunEnabledUI: true,
  sunColorUI: [1, 1, 1] as [number, number, number],
  sunIntensityUI: 1.0,
  sunYawDegUI: -26,
  sunPitchDegUI: -50,
  sunCastsShadowsUI: true,
  shadowMapSizeUI: 2048,
  shadowSlopeScaleBiasUI: 3.0,
  shadowConstantBiasUI: 1.0,
  shadowDepthBiasUI: 0.0015,
  shadowPcfRadiusUI: 1.0,
  shadowOrthoExtentUI: 20.0,
  toneMappingEnabledUI: true,
  iblSelectedIndexUI: 0,
  iblSizeUI: 2048,
};

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

  worker.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (msg?.type === "READY") {
      const snap = readEngineSnapshot(engineStateCtx);
      uiState.fogEnabledUI = snap.fog.enabled;
      uiState.fogColorUI = [
        snap.fog.color[0],
        snap.fog.color[1],
        snap.fog.color[2],
      ];
      uiState.fogDensityUI = snap.fog.density;
      uiState.fogHeightUI = snap.fog.height;
      uiState.fogFalloffUI = snap.fog.heightFalloff;
      uiState.fogInscatterUI = snap.fog.inscatteringIntensity;
      uiState.sunEnabledUI = snap.sun.enabled;
      uiState.sunColorUI = [
        snap.sun.color[0],
        snap.sun.color[1],
        snap.sun.color[2],
      ];
      uiState.sunIntensityUI = snap.sun.intensity;
      const { yaw, pitch } = dirToYawPitchDeg(
        snap.sun.direction[0],
        snap.sun.direction[1],
        snap.sun.direction[2],
      );
      uiState.sunCastsShadowsUI = snap.sun.castsShadows ?? true;
      uiState.sunYawDegUI = yaw;
      uiState.sunPitchDegUI = pitch;
      uiState.shadowMapSizeUI = snap.shadow.mapSize;
      uiState.shadowSlopeScaleBiasUI = snap.shadow.slopeScaleBias;
      uiState.shadowConstantBiasUI = snap.shadow.constantBias;
      uiState.shadowDepthBiasUI = snap.shadow.depthBias;
      uiState.shadowPcfRadiusUI = snap.shadow.pcfRadius;
      uiState.shadowOrthoExtentUI = snap.shadow.orthoHalfExtent;
      engineReady = true;
    }
  });

  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);
  document.addEventListener("pointerlockchange", handlePointerLockChange);
  canvas.addEventListener("click", handleCanvasClick);
  uiCanvas.addEventListener("click", handleUICanvasClick);
  document.addEventListener("mousemove", handleMouseMove);
}

export async function initGPU() {
  if (!navigator.gpu) throw new Error("WebGPU not supported");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No adapter found");
  uiDevice = await adapter.requestDevice();

  uiCanvas.width = canvas.clientWidth;
  uiCanvas.height = canvas.clientHeight;

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

function dirToYawPitchDeg(
  x: number,
  y: number,
  z: number,
): { yaw: number; pitch: number } {
  const pitch = Math.asin(Math.max(-1, Math.min(1, y)));
  const yaw = Math.atan2(z, x);
  return { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
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

  fogWidget.render(engineStateCtx, uiState, engineReady);
  sunWidget.render(engineStateCtx, uiState, engineReady);
  shadowWidget.render(engineStateCtx, uiState, engineReady);
  renderingWidget.render(worker, uiState);
  iblWidget.render(worker, uiState);

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

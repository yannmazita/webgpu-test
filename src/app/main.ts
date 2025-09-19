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
import { ImGui } from "@mori2003/jsimgui";
import { beginDebugUIFrame, endDebugUI, initDebugUI } from "@/core/debugUI";
import { SHARED_ENGINE_STATE_BUFFER_SIZE } from "@/core/sharedEngineStateLayout";
import {
  createEngineStateContext as createEngineStateCtx,
  initializeEngineStateHeader,
  readSnapshot as readEngineSnapshot,
  setFogEnabled,
  setFogColor,
  setFogParams,
  setSunEnabled,
  setSunDirection,
  setSunColorAndIntensity,
  setShadowMapSize,
  setShadowParams0,
  setShadowOrthoHalfExtent,
} from "@/core/engineState";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) throw new Error("Canvas element not found");

const uiCanvas = document.querySelector<HTMLCanvasElement>("#ui-canvas");
if (!uiCanvas) throw new Error("UI Canvas element not found");

const hud = document.querySelector<HTMLDivElement>("#hud");
if (!hud) throw new Error("HUD element not found");

// --- ImGui State ---
let uiDevice: GPUDevice | null = null;
let uiContext: GPUCanvasContext | null = null;

async function initUI() {
  if (!navigator.gpu) throw new Error("WebGPU not supported");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No adapter found");
  uiDevice = await adapter.requestDevice();

  uiCanvas.width = canvas.clientWidth;
  uiCanvas.height = canvas.clientHeight;

  // Create a WebGPU context for the UI canvas
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
}

// Setup shared memory and contexts
const inputBuffer = new SharedArrayBuffer(SHARED_BUFFER_SIZE);
const inputContext = createInputContext(inputBuffer);

const metricsBuffer = new SharedArrayBuffer(METRICS_BUFFER_SIZE);
const metricsContext = createMetricsContext(metricsBuffer);

const engineStateBuffer = new SharedArrayBuffer(
  SHARED_ENGINE_STATE_BUFFER_SIZE,
);
const engineStateCtx = createEngineStateCtx(engineStateBuffer);
console.log(
  "[Main] EngineState SAB bytes=",
  engineStateBuffer.byteLength,
  " i32.len=",
  (engineStateCtx as any).i32.length,
  " f32.len=",
  (engineStateCtx as any).f32.length,
);
initializeEngineStateHeader(engineStateCtx);

// --- Input Event Handling ---
let isPointerLockedState = false;
let mouseX = 0;
let mouseY = 0;

const updateUICanvasInteractivity = (): void => {
  // When pointer is unlocked, always allow UI canvas to receive events
  // so the user can re-activate ImGui by clicking it.
  if (!isPointerLockedState) {
    uiCanvas.style.pointerEvents = "auto";
    return;
  }

  // When pointer is locked, allow UI canvas events only if ImGui wants them
  // (rare case: overlays you explicitly open).
  const io = ImGui.GetIO();
  uiCanvas.style.pointerEvents = io.WantCaptureMouse ? "auto" : "none";
};

const handleKeyDown = (e: KeyboardEvent): void => {
  updateKeyState(inputContext, e.code, true);

  if (e.code === "Escape" && isPointerLockedState) {
    document.exitPointerLock();
    // Immediately enable UI interactivity upon unlock
    // (pointerlockchange event also handles it, but do it proactively).
    setTimeout(updateUICanvasInteractivity, 0);
  }
};

const handleKeyUp = (e: KeyboardEvent): void => {
  updateKeyState(inputContext, e.code, false);
};

const handleCanvasClick = async (e: MouseEvent): Promise<void> => {
  const io = ImGui.GetIO();

  // If ImGui wants the mouse, don't lock.
  if (io.WantCaptureMouse) return;

  // Only lock pointer if we're actually clicking the game canvas and pointer isn't already locked
  if (e.target === canvas && !isPointerLockedState) {
    await canvas.requestPointerLock();
  }
};

const handleUICanvasClick = async (e: MouseEvent): Promise<void> => {
  const io = ImGui.GetIO();

  // If already locked, consume event (safety; normally events go to locked element)
  if (isPointerLockedState) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // When unlocked: if ImGui wants the mouse, let UI handle it (no lock).
  // If ImGui does not want the mouse (clicked "empty" UI area), initiate pointer lock.
  if (!io.WantCaptureMouse) {
    e.preventDefault();
    e.stopPropagation();
    await canvas.requestPointerLock();
    // Interactivity will update on pointerlockchange
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

  // Update UI pointer-events now that lock state changed
  updateUICanvasInteractivity();
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
canvas.addEventListener("click", handleCanvasClick);
uiCanvas.addEventListener("click", handleUICanvasClick);
document.addEventListener("mousemove", handleMouseMove);

// --- HUD Setup ---
hud.textContent = "Initializing...";

const HUD_UPDATE_INTERVAL_MS = 250;
let lastHudUpdateTime = 0;
let lastHudFrameId = 0;

let engineReady = false;

// -- UI state for editor --
// Fog
let fogEnabledUI = true;
let fogColorUI: [number, number, number] = [0.5, 0.6, 0.7];
let fogDensityUI = 0.02;
let fogHeightUI = 0.0;
let fogFalloffUI = 0.1;
let fogInscatterUI = 0.8;

// Sun
let sunEnabledUI = true;
let sunColorUI: [number, number, number] = [1, 1, 1];
let sunIntensityUI = 1.0;
let sunYawDegUI = -26; // azimuth, rough default
let sunPitchDegUI = -50; // elevation

// Shadows
let shadowMapSizeUI = 2048;
let shadowSlopeScaleBiasUI = 3.0;
let shadowConstantBiasUI = 1.0;
let shadowDepthBiasUI = 0.0015;
let shadowPcfRadiusUI = 1.0;
let shadowOrthoExtentUI = 20.0;

// Rendering
let toneMappingEnabledUI = true;

function dirToYawPitchDeg(
  x: number,
  y: number,
  z: number,
): { yaw: number; pitch: number } {
  // Y up. yaw about +Y from +X axis, pitch elevation from horizon.
  const pitch = Math.asin(Math.max(-1, Math.min(1, y))); // [-pi/2, pi/2]
  const yaw = Math.atan2(z, x); // [-pi, pi]
  return { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
}
function yawPitchDegToDir(
  yawDeg: number,
  pitchDeg: number,
): [number, number, number] {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const cp = Math.cos(pitch);
  const x = cp * Math.cos(yaw);
  const y = Math.sin(pitch);
  const z = cp * Math.sin(yaw);
  return [x, y, z];
}

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
    `Cluster L/cluster avg/max: ${avgL.toFixed(2)}/${maxL}  |  Overflows: ${ofl}\n` +
    `Pointer Lock: ${isPointerLockedState ? "ON" : "OFF"} (Press ESC to exit, C to toggle camera)`;

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
    sharedEngineStateBuffer: engineStateBuffer,
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

    // Initialize UI from engine snapshot
    const snap = readEngineSnapshot(engineStateCtx);
    fogEnabledUI = snap.fog.enabled;
    fogColorUI = [snap.fog.color[0], snap.fog.color[1], snap.fog.color[2]];
    fogDensityUI = snap.fog.density;
    fogHeightUI = snap.fog.height;
    fogFalloffUI = snap.fog.heightFalloff;
    fogInscatterUI = snap.fog.inscatteringIntensity;

    sunEnabledUI = snap.sun.enabled;
    sunColorUI = [snap.sun.color[0], snap.sun.color[1], snap.sun.color[2]];
    sunIntensityUI = snap.sun.intensity;
    const { yaw, pitch } = dirToYawPitchDeg(
      snap.sun.direction[0],
      snap.sun.direction[1],
      snap.sun.direction[2],
    );
    sunYawDegUI = yaw;
    sunPitchDegUI = pitch;

    shadowMapSizeUI = snap.shadow.mapSize;
    shadowSlopeScaleBiasUI = snap.shadow.slopeScaleBias;
    shadowConstantBiasUI = snap.shadow.constantBias;
    shadowDepthBiasUI = snap.shadow.depthBias;
    shadowPcfRadiusUI = snap.shadow.pcfRadius;
    shadowOrthoExtentUI = snap.shadow.orthoHalfExtent;

    engineReady = true;
    return;
  }

  if (msg.type === "FRAME_DONE") {
    canSendFrame = true;
    return;
  }
});

function drawUI() {
  if (!uiDevice || !uiContext) return;

  beginDebugUIFrame(uiCanvas);

  // --- ImGui widgets ---
  ImGui.Begin("Editor");

  ImGui.Separator();
  ImGui.Text(`Pointer Lock: ${isPointerLockedState ? "ON" : "OFF"}`);
  ImGui.Text("Press ESC to exit pointer lock");
  ImGui.Text("Press C to toggle camera mode");

  const io = ImGui.GetIO();
  ImGui.Text(`ImGui WantCaptureMouse: ${io.WantCaptureMouse}`);
  ImGui.Text(`ImGui WantCaptureKeyboard: ${io.WantCaptureKeyboard}`);

  ImGui.Separator();
  if (ImGui.CollapsingHeader("Fog", ImGui.TreeNodeFlags.DefaultOpen)) {
    const fogEnabledRef: [boolean] = [fogEnabledUI];
    if (ImGui.Checkbox("Enabled##Fog", fogEnabledRef) && engineReady) {
      fogEnabledUI = fogEnabledRef[0];
      setFogEnabled(engineStateCtx, fogEnabledUI);
    }

    const fogColorRef: [number, number, number] = [
      fogColorUI[0],
      fogColorUI[1],
      fogColorUI[2],
    ];
    if (ImGui.ColorEdit3("Color##Fog", fogColorRef) && engineReady) {
      fogColorUI = [fogColorRef[0], fogColorRef[1], fogColorRef[2]];
      setFogColor(
        engineStateCtx,
        fogColorUI[0],
        fogColorUI[1],
        fogColorUI[2],
        1.0,
      );
    }

    const densityRef: [number] = [fogDensityUI];
    if (
      ImGui.SliderFloat("Density##Fog", densityRef, 0.0, 1.0) &&
      engineReady
    ) {
      fogDensityUI = densityRef[0];
      setFogParams(
        engineStateCtx,
        fogDensityUI,
        fogHeightUI,
        fogFalloffUI,
        fogInscatterUI,
      );
    }

    const heightRef: [number] = [fogHeightUI];
    if (
      ImGui.SliderFloat("Height##Fog", heightRef, -50.0, 50.0) &&
      engineReady
    ) {
      fogHeightUI = heightRef[0];
      setFogParams(
        engineStateCtx,
        fogDensityUI,
        fogHeightUI,
        fogFalloffUI,
        fogInscatterUI,
      );
    }
    const falloffRef: [number] = [fogFalloffUI];
    if (
      ImGui.SliderFloat("Height Falloff##Fog", falloffRef, 0.0, 1.0) &&
      engineReady
    ) {
      fogFalloffUI = falloffRef[0];
      setFogParams(
        engineStateCtx,
        fogDensityUI,
        fogHeightUI,
        fogFalloffUI,
        fogInscatterUI,
      );
    }
    const inscatterRef: [number] = [fogInscatterUI];
    if (
      ImGui.SliderFloat("Inscatter Intensity##Fog", inscatterRef, 0.0, 10.0) &&
      engineReady
    ) {
      fogInscatterUI = inscatterRef[0];
      setFogParams(
        engineStateCtx,
        fogDensityUI,
        fogHeightUI,
        fogFalloffUI,
        fogInscatterUI,
      );
    }
  }

  if (ImGui.CollapsingHeader("Sun", ImGui.TreeNodeFlags.DefaultOpen)) {
    const sunEnabledRef: [boolean] = [sunEnabledUI];
    if (ImGui.Checkbox("Enabled##Sun", sunEnabledRef) && engineReady) {
      sunEnabledUI = sunEnabledRef[0];
      setSunEnabled(engineStateCtx, sunEnabledUI);
    }

    const sunColorRef: [number, number, number] = [
      sunColorUI[0],
      sunColorUI[1],
      sunColorUI[2],
    ];
    if (ImGui.ColorEdit3("Color##Sun", sunColorRef) && engineReady) {
      sunColorUI = [sunColorRef[0], sunColorRef[1], sunColorRef[2]];
      setSunColorAndIntensity(
        engineStateCtx,
        sunColorUI[0],
        sunColorUI[1],
        sunColorUI[2],
        sunIntensityUI,
      );
    }

    const sunIntensityRef: [number] = [sunIntensityUI];
    if (
      ImGui.SliderFloat("Intensity##Sun", sunIntensityRef, 0.0, 50.0) &&
      engineReady
    ) {
      sunIntensityUI = sunIntensityRef[0];
      setSunColorAndIntensity(
        engineStateCtx,
        sunColorUI[0],
        sunColorUI[1],
        sunColorUI[2],
        sunIntensityUI,
      );
    }

    const yawRef: [number] = [sunYawDegUI];
    const pitchRef: [number] = [sunPitchDegUI];
    let changedAngles = false;
    if (ImGui.SliderFloat("Yaw (deg)##Sun", yawRef, -180.0, 180.0)) {
      changedAngles = true;
    }
    if (ImGui.SliderFloat("Pitch (deg)##Sun", pitchRef, -89.9, 89.9)) {
      changedAngles = true;
    }
    if (changedAngles && engineReady) {
      sunYawDegUI = yawRef[0];
      sunPitchDegUI = pitchRef[0];
      const [dx, dy, dz] = yawPitchDegToDir(sunYawDegUI, sunPitchDegUI);
      setSunDirection(engineStateCtx, dx, dy, dz);
    }

    if (ImGui.TreeNode("Advanced Vector (normalized)")) {
      // Display only; editing raw XYZ is discouraged in v1
      const [dx, dy, dz] = yawPitchDegToDir(sunYawDegUI, sunPitchDegUI);
      ImGui.Text(`Dir: ${dx.toFixed(3)}, ${dy.toFixed(3)}, ${dz.toFixed(3)}`);
      ImGui.TreePop();
    }
  }

  if (ImGui.CollapsingHeader("Shadows", ImGui.TreeNodeFlags.DefaultOpen)) {
    const sizes = [256, 512, 1024, 2048, 4096, 8192];

    const currentLabel = `${shadowMapSizeUI}`;
    if (ImGui.BeginCombo("Map Size", currentLabel)) {
      for (const size of sizes) {
        const label = `${size}`;
        const isSelected = shadowMapSizeUI === size;
        if (ImGui.Selectable(label, isSelected)) {
          shadowMapSizeUI = size;
          if (engineReady) setShadowMapSize(engineStateCtx, shadowMapSizeUI);
        }
        if (isSelected) ImGui.SetItemDefaultFocus();
      }
      ImGui.EndCombo();
    }

    const slopeRef: [number] = [shadowSlopeScaleBiasUI];
    const constRef: [number] = [shadowConstantBiasUI];
    const depthRef: [number] = [shadowDepthBiasUI];
    const pcfRef: [number] = [shadowPcfRadiusUI];
    let changedShadow0 = false;

    if (ImGui.SliderFloat("Slope Scale Bias", slopeRef, 0.0, 16.0))
      changedShadow0 = true;
    if (ImGui.SliderFloat("Constant Bias", constRef, 0.0, 4096.0))
      changedShadow0 = true;
    if (ImGui.SliderFloat("Depth Bias", depthRef, 0.0, 0.02))
      changedShadow0 = true;
    if (ImGui.SliderFloat("PCF Radius", pcfRef, 0.0, 5.0))
      changedShadow0 = true;

    if (changedShadow0 && engineReady) {
      shadowSlopeScaleBiasUI = slopeRef[0];
      shadowConstantBiasUI = constRef[0];
      shadowDepthBiasUI = depthRef[0];
      shadowPcfRadiusUI = pcfRef[0];
      setShadowParams0(
        engineStateCtx,
        shadowSlopeScaleBiasUI,
        shadowConstantBiasUI,
        shadowDepthBiasUI,
        shadowPcfRadiusUI,
      );
    }

    const orthoRef: [number] = [shadowOrthoExtentUI];
    if (
      ImGui.SliderFloat("Ortho Half Extent", orthoRef, 1.0, 500.0) &&
      engineReady
    ) {
      shadowOrthoExtentUI = orthoRef[0];
      setShadowOrthoHalfExtent(engineStateCtx, shadowOrthoExtentUI);
    }
  }

  if (ImGui.CollapsingHeader("Rendering", ImGui.TreeNodeFlags.DefaultOpen)) {
    // Tone mapping toggle (communicated to worker)
    const toneMapRef: [boolean] = [toneMappingEnabledUI];
    if (ImGui.Checkbox("Tone Mapping (ACES)", toneMapRef)) {
      toneMappingEnabledUI = toneMapRef[0];
      worker.postMessage({
        type: "SET_TONE_MAPPING",
        enabled: toneMappingEnabledUI,
      });
    }
  }

  ImGui.End();

  // UI interactivity reflects current lock & ImGui state every frame
  updateUICanvasInteractivity();

  // --- Render ---
  const uiCommandEncoder = uiDevice.createCommandEncoder();

  const textureView = uiContext.getCurrentTexture().createView();

  const uiPassEncoder = uiCommandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: textureView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 }, // transparent clear
      },
    ],
  });
  endDebugUI(uiPassEncoder);
  uiPassEncoder.end();

  uiDevice.queue.submit([uiCommandEncoder.finish()]);
}

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
  drawUI();
  requestAnimationFrame(tick);
};

await initUI();
updateUICanvasInteractivity();
requestAnimationFrame(tick);

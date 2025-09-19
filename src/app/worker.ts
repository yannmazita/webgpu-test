// src/app/worker.ts
/// <reference lib="webworker" />

import { Renderer } from "@/core/rendering/renderer";
import { ResourceManager } from "@/core/resources/resourceManager";
import { World } from "@/core/ecs/world";
import { cameraSystem } from "@/core/ecs/systems/cameraSystem";
import { transformSystem } from "@/core/ecs/systems/transformSystem";
import { renderSystem } from "@/core/ecs/systems/renderSystem";
import { SceneRenderData } from "@/core/types/rendering";
import { CameraControllerSystem } from "@/core/ecs/systems/cameraControllerSystem";
import { IInputSource } from "@/core/input/iinputSource";
import {
  createInputContext,
  InputContext,
  isKeyDown,
  getAndResetMouseDelta,
  getMousePosition,
  isPointerLocked,
} from "@/core/input/manager";
import {
  createMetricsContext,
  initializeMetrics,
  MetricsContext,
  publishMetrics,
} from "@/core/metrics";
import {
  ActionMapConfig,
  ActionStateMap,
  getAxisValue,
  IActionController,
  isActionPressed,
  wasActionPressed,
} from "@/core/input/action";
import { animationSystem } from "@/core/ecs/systems/animationSystem";
import { createDefaultScene } from "./scene";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import {
  InitMsg,
  ResizeMsg,
  FrameMsg,
  ToneMapMsg,
  MSG_INIT,
  MSG_RESIZE,
  MSG_FRAME,
  MSG_SET_TONE_MAPPING,
} from "@/core/types/worker";
import {
  createEngineStateContext as createEngineStateCtx,
  EngineStateContext as EngineStateCtx,
  syncEngineState,
  publishSnapshotFromWorld,
} from "@/core/engineState";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { mat4, quat, vec3 } from "wgpu-matrix";

let engineStateCtx: EngineStateCtx | null = null;

let renderer: Renderer | null = null;
let resourceManager: ResourceManager | null = null;
let world: World | null = null;
let sceneRenderData: SceneRenderData | null = null;

let cameraEntity = -1;
let demoModelEntity = -1;

let inputContext: InputContext | null = null;
let actionController: IActionController | null = null;
let cameraControllerSystem: CameraControllerSystem | null = null;
let isFreeCameraActive = false;
const previousActionState: ActionStateMap = new Map();

let metricsContext: MetricsContext | null = null;
let metricsFrameId = 0;

// State for dt and camera orbit
let lastFrameTime = 0;
let animationStartTime = 0;
const orbitRadius = 15.0;
const orbitHeight = 2.0;

async function initWorker(
  offscreen: OffscreenCanvas,
  sharedInputBuffer: SharedArrayBuffer,
  sharedMetricsBuffer: SharedArrayBuffer,
  sharedEngineStateBuffer: SharedArrayBuffer,
) {
  console.log("[Worker] Initializing...");
  renderer = new Renderer(offscreen);
  console.log("[Worker] Awaiting renderer init...");
  await renderer.init();
  console.log("[Worker] Renderer initialized.");

  // Metrics setup
  metricsContext = createMetricsContext(sharedMetricsBuffer);
  initializeMetrics(metricsContext);

  // Input setup
  inputContext = createInputContext(sharedInputBuffer, false);
  const inputReader: IInputSource = {
    isKeyDown: (code: string) => isKeyDown(inputContext!, code),
    getMouseDelta: () => getAndResetMouseDelta(inputContext!),
    getMousePosition: () => getMousePosition(inputContext!),
    isPointerLocked: () => isPointerLocked(inputContext!),
    lateUpdate: () => {},
  };

  const actionMap: ActionMapConfig = {
    move_vertical: { type: "axis", positiveKey: "KeyW", negativeKey: "KeyS" },
    move_horizontal: { type: "axis", positiveKey: "KeyD", negativeKey: "KeyA" },
    move_y_axis: {
      type: "axis",
      positiveKey: "Space",
      negativeKey: "ShiftLeft",
    },
    toggle_camera_mode: { type: "button", keys: ["KeyC"] },
  };

  actionController = {
    isPressed: (name: string) => isActionPressed(actionMap, inputReader, name),
    wasPressed: (name: string) =>
      wasActionPressed(actionMap, inputReader, name, previousActionState),
    getAxis: (name: string) => getAxisValue(actionMap, inputReader, name),
    getMouseDelta: () => inputReader.getMouseDelta(),
    isPointerLocked: () => inputReader.isPointerLocked(),
  };

  // Engine editor state: validate buffer before using
  try {
    if (
      sharedEngineStateBuffer &&
      (sharedEngineStateBuffer as any) instanceof SharedArrayBuffer
    ) {
      engineStateCtx = createEngineStateCtx(sharedEngineStateBuffer);
      console.log(
        "[Worker] EngineState SAB created. i32.len=",
        engineStateCtx.i32.length,
        " f32.len=",
        engineStateCtx.f32.length,
      );
    } else {
      console.warn(
        "[Worker] sharedEngineStateBuffer missing or not a SharedArrayBuffer.",
      );
      engineStateCtx = null;
    }
  } catch (e) {
    console.error("[Worker] Failed to create EngineState context:", e);
    engineStateCtx = null;
  }

  cameraControllerSystem = new CameraControllerSystem(actionController);

  resourceManager = new ResourceManager(renderer);
  world = new World();
  sceneRenderData = new SceneRenderData();

  // --- Scene Setup ---
  const sceneEntities = await createDefaultScene(world, resourceManager);
  cameraEntity = sceneEntities.cameraEntity;
  demoModelEntity = sceneEntities.demoModelEntity;

  if (engineStateCtx) {
    // Only publish if the buffer looks large enough to hold header+flags
    if ((engineStateCtx.i32.length | 0) >= 4) {
      publishSnapshotFromWorld(world, engineStateCtx);
    } else {
      console.warn(
        "[Worker] EngineState SAB too small; skipping snapshot. i32.len=",
        engineStateCtx.i32.length,
      );
    }
  }

  (self as any).postMessage({ type: "READY" });
}

function frame(now: number) {
  if (
    !renderer ||
    !world ||
    !sceneRenderData ||
    !cameraControllerSystem ||
    !actionController
  )
    return;

  // apply editor state before systems
  if (engineStateCtx) {
    syncEngineState(world, engineStateCtx);
  }

  const MAX_PAUSE = 0.5;
  let dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 0;
  lastFrameTime = now;
  if (dt > MAX_PAUSE) dt = MAX_PAUSE;

  if (actionController.wasPressed("toggle_camera_mode")) {
    isFreeCameraActive = !isFreeCameraActive;
    if (isFreeCameraActive) {
      const cameraTransform = world.getComponent(
        cameraEntity,
        TransformComponent,
      )!;
      cameraControllerSystem.syncFromTransform(cameraTransform);
    }
  }

  const cameraTransform = world.getComponent(cameraEntity, TransformComponent)!;

  if (isFreeCameraActive) {
    // Free camera mode
    cameraControllerSystem.update(world, dt);
  } else {
    // Orbital camera animation around the model
    if (animationStartTime === 0) animationStartTime = now;

    const ORBIT_DURATION_MS = 20000; // 20 seconds for full orbit
    const elapsed = (now - animationStartTime) % ORBIT_DURATION_MS;
    const t = elapsed / ORBIT_DURATION_MS; // normalized [0,1)

    const angle = t * Math.PI * 2; // full 360 orbit
    const x = Math.cos(angle) * orbitRadius;
    const z = Math.sin(angle) * orbitRadius;
    const y = orbitHeight;

    // Camera position
    const eye = vec3.fromValues(x, y, z);
    const target = vec3.fromValues(0, 0, 0);
    const up = vec3.fromValues(0, 1, 0);

    // Build a lookAt *view* matrix
    const view = mat4.lookAt(eye, target, up);

    // Convert to world transform by inverting the view matrix
    const worldFromView = mat4.invert(view);

    // Extract orientation (upper 3×3) and convert to quaternion
    const rotation = quat.fromMat(worldFromView);

    // Apply position + rotation to the camera
    cameraTransform.setPosition(x, y, z);
    cameraTransform.setRotation(rotation);
  }

  /*
  // Rotate the model slowly
  if (demoModelEntity !== -1) {
    const demoModelTransform = world.getComponent(
      demoModelEntity,
      TransformComponent,
    );
    if (demoModelTransform) {
      const HELMET_ROTATION_SPEED = 0.3; // radians per second
      const rotationY = (now / 1000) * HELMET_ROTATION_SPEED;
      const rotation = quat.fromEuler(0, rotationY, 0, "xyz");
      demoModelTransform.setRotation(rotation);
    }
  }
  */

  // Drive animations (node-TRS) before recomputing world transforms
  animationSystem(world, dt);

  transformSystem(world);
  cameraSystem(world);

  renderSystem(world, renderer, sceneRenderData);

  if (metricsContext && renderer) {
    publishMetrics(metricsContext, renderer.getStats(), dt, ++metricsFrameId);
  }

  (self as any).postMessage({ type: "FRAME_DONE" });
}

self.onmessage = async (
  ev: MessageEvent<InitMsg | ResizeMsg | FrameMsg | ToneMapMsg>,
) => {
  const msg = ev.data;

  if (msg.type === MSG_INIT) {
    await initWorker(
      msg.canvas,
      msg.sharedInputBuffer,
      msg.sharedMetricsBuffer,
      msg.sharedEngineStateBuffer,
    );
    return;
  }

  if (!renderer || !world) {
    if (msg.type === MSG_FRAME) {
      (self as any).postMessage({ type: "FRAME_DONE" });
    }
    return;
  }

  switch (msg.type) {
    case MSG_RESIZE: {
      const cam = world.getComponent(cameraEntity, CameraComponent)!;
      renderer.requestResize(
        msg.cssWidth,
        msg.cssHeight,
        msg.devicePixelRatio,
        cam,
      );
      break;
    }
    case MSG_FRAME: {
      frame(msg.now);
      break;
    }
    case MSG_SET_TONE_MAPPING: {
      if (renderer) {
        renderer.setToneMappingEnabled(!!msg.enabled);
        // Optional: console log for visibility while testing
        console.log("[Worker] Tone mapping set to:", !!msg.enabled);
      }
      break;
    }
  }
};

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
  MSG_SET_ENVIRONMENT,
  SetEnvironmentMsg,
} from "@/core/types/worker";
import {
  createEngineStateContext as createEngineStateCtx,
  EngineStateContext as EngineStateCtx,
  syncEngineState,
  publishSnapshotFromWorld,
} from "@/core/engineState";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { mat4, quat, vec3 } from "wgpu-matrix";
import { SkyboxComponent } from "@/core/ecs/components/skyboxComponent";
import { IBLComponent } from "@/core/ecs/components/iblComponent";

// Physics imports (Stage 2)
import {
  PhysicsContext,
  createPhysicsContext,
  initializePhysicsHeaders,
} from "@/core/physicsState";
import {
  PhysicsInitMsg,
  PhysicsMessage,
  PhysicsReadyMsg,
  PhysicsErrorMsg,
  PhysicsStepDoneMsg,
  PhysicsDestroyedMsg,
} from "@/core/types/physics";
import { PhysicsCommandSystem } from "@/core/ecs/systems/physicsCommandSystem";
import {
  COMMANDS_BUFFER_SIZE,
  STATES_BUFFER_SIZE,
} from "@/core/sharedPhysicsLayout";

/**
 * Main render worker script.
 *
 * This worker handles the core rendering loop, ECS systems, input processing,
 * and shared state synchronization with the main thread. It receives messages
 * from the main thread (e.g., INIT, FRAME, RESIZE) and responds with readiness
 * signals (READY, FRAME_DONE). All heavy computation (rendering, physics commands)
 * occurs here, isolated from the main thread for smooth 60FPS.
 *
 * Key flows:
 * - INIT: Set up renderer, ECS world, scene, input/metrics, physics (Stage 2).
 * - FRAME: Process input, run systems (physics commands, animation, transform,
 *   camera, render), publish metrics.
 * - RESIZE: Update canvas/viewport and camera aspect.
 * - Shared state: SABs for input (real-time), metrics (UI), engine (editor tweaks),
 *   physics (commands/states).
 *
 * Assumptions:
 * - OffscreenCanvas transferred via postMessage.
 * - COOP/COEP enabled for SABs.
 * - No direct DOM access (all UI via main thread).
 */
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

// Physics globals (Stage 2)
let physicsCtx: PhysicsContext | null = null;
let physicsCommandSystem: PhysicsCommandSystem | null = null;
let physicsWorker: Worker | null = null;

// State for dt and camera orbit
let lastFrameTime = 0;
let animationStartTime = 0;
const orbitRadius = 15.0;
const orbitHeight = 2.0;

/**
 * Initializes the render worker.
 *
 * Sets up the GPU renderer, shared contexts (input, metrics, engine state),
 * input action mapping, camera controller, resource manager, ECS world, and scene.
 * Creates the physics worker and posts INIT to it (Stage 2). Publishes an initial
 * engine state snapshot for the main thread UI. Posts READY to signal completion.
 *
 * @param offscreen OffscreenCanvas for WebGPU rendering (transferred from main).
 * @param sharedInputBuffer SharedArrayBuffer for input state (keyboard/mouse).
 * @param sharedMetricsBuffer SharedArrayBuffer for performance metrics.
 * @param sharedEngineStateBuffer SharedArrayBuffer for editor state sync.
 * @returns Promise that resolves when initialization completes.
 */
async function initWorker(
  offscreen: OffscreenCanvas,
  sharedInputBuffer: SharedArrayBuffer,
  sharedMetricsBuffer: SharedArrayBuffer,
  sharedEngineStateBuffer: SharedArrayBuffer,
): Promise<void> {
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
  try {
    console.log("[Worker] Creating default scene...");
    const sceneEntities = await createDefaultScene(world, resourceManager);
    cameraEntity = sceneEntities.cameraEntity;
    demoModelEntity = sceneEntities.demoModelEntity;
    console.log("[Worker] Scene created successfully");
  } catch (error) {
    console.error("[Worker] Failed to create scene:", error);
    throw error;
  }

  // --- Physics Setup (Stage 2) ---
  console.log("[Worker] Setting up physics...");
  const commandsBuffer = new SharedArrayBuffer(COMMANDS_BUFFER_SIZE);
  const statesBuffer = new SharedArrayBuffer(STATES_BUFFER_SIZE);
  physicsCtx = createPhysicsContext(commandsBuffer, statesBuffer);
  initializePhysicsHeaders(physicsCtx);

  // Create physics worker
  physicsWorker = new Worker(new URL("./physicsWorker.ts", import.meta.url), {
    type: "module",
  });

  // Listen for physics worker messages
  physicsWorker.addEventListener(
    "message",
    (ev: MessageEvent<PhysicsMessage>) => {
      const msg = ev.data;
      if (msg.type === "READY") {
        console.log("[Worker] Physics worker ready.");
      } else if (msg.type === "ERROR") {
        console.error("[Worker] Physics worker error:", msg.error);
      } else if (msg.type === "STEP_DONE") {
        console.log("[Worker] Physics step complete:", msg.log);
      } else if (msg.type === "DESTROYED") {
        console.log("[Worker] Physics worker destroyed.");
      }
    },
  );

  // Post INIT to physics worker
  const initMsg: PhysicsInitMsg = {
    type: "INIT",
    commandsBuffer,
    statesBuffer,
  };
  physicsWorker.postMessage(initMsg);

  // Create command system
  physicsCommandSystem = new PhysicsCommandSystem(physicsCtx!);

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

/**
 * Main frame update loop.
 *
 * Processes input, applies editor state, updates camera (free/orbit mode),
 * runs ECS systems in order (physics commands, animation, transform, camera, render),
 * publishes metrics, and signals FRAME_DONE. Ensures frame-rate independent
 * movement via delta time clamping.
 *
 * @param now Current timestamp (from requestAnimationFrame, in ms).
 */
function frame(now: number): void {
  if (
    !renderer ||
    !world ||
    !sceneRenderData ||
    !cameraControllerSystem ||
    !actionController
  )
    return;

  // Apply editor state before systems
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

  // Physics commands (early: queue async creates/destroys before systems, Stage 2)
  if (physicsCommandSystem) {
    physicsCommandSystem.update(world);
  }

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

/**
 * Message event handler for the worker.
 *
 * Dispatches incoming postMessages from the main thread:
 * - INIT: Full worker setup (renderer, ECS, physics, etc.).
 * - RESIZE: Update canvas dimensions and camera projection.
 * - FRAME: Trigger one frame of update/render.
 * - SET_TONE_MAPPING: Toggle post-processing tone mapping.
 * - SET_ENVIRONMENT: Load new HDR environment map and update IBL/skybox.
 *
 * Physics messages are handled via SABs (no direct dispatch here).
 *
 * @param ev MessageEvent containing the payload (typed union).
 */
self.onmessage = async (
  ev: MessageEvent<
    InitMsg | ResizeMsg | FrameMsg | ToneMapMsg | SetEnvironmentMsg
  >,
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
      // camera may not be ready if scene creation failed/hasn't finished
      const cam =
        cameraEntity !== -1
          ? world.getComponent(cameraEntity, CameraComponent)
          : undefined;
      if (cam) {
        renderer.requestResize(
          msg.cssWidth,
          msg.cssHeight,
          msg.devicePixelRatio,
          cam,
        );
      } else {
        console.warn("[Worker] Resize skipped: camera not ready yet");
      }
      break;
    }
    case MSG_FRAME: {
      frame(msg.now);
      break;
    }
    case MSG_SET_TONE_MAPPING: {
      if (renderer) {
        renderer.setToneMappingEnabled(!!msg.enabled);
      }
      break;
    }
    case MSG_SET_ENVIRONMENT: {
      // Narrow typing guard
      const m = msg as any;
      try {
        if (!resourceManager || !world) break;
        const env = await resourceManager.createEnvironmentMap(
          String(m.url),
          Math.max(16, Math.min(4096, Number(m.size) | 0)),
        );
        // Replace global resources
        world.removeResource(SkyboxComponent);
        world.addResource(new SkyboxComponent(env.skyboxMaterial));
        world.removeResource(IBLComponent);
        world.addResource(env.iblComponent);
        console.log("[Worker] Environment updated:", m.url, "size=", m.size);
      } catch (e) {
        console.error("[Worker] Failed to update environment:", e);
      }
      break;
    }
  }
};

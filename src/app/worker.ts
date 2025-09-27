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

// Physics imports
import {
  PhysicsContext,
  createPhysicsContext,
  initializePhysicsHeaders,
} from "@/core/physicsState";
import { PhysicsInitMsg, PhysicsMessage } from "@/core/types/physics";
import { PhysicsCommandSystem } from "@/core/ecs/systems/physicsCommandSystem";
import {
  COMMANDS_BUFFER_SIZE,
  STATES_BUFFER_SIZE,
  STATES_GEN_OFFSET,
  STATES_MAX_BODIES,
  STATES_SLOT_COUNT,
  STATES_SLOT_OFFSET,
  STATES_SLOT_SIZE,
  STATES_PHYSICS_STEP_TIME_MS_OFFSET,
  STATES_WRITE_INDEX_OFFSET,
} from "@/core/sharedPhysicsLayout";
import { PhysicsBodyComponent } from "@/core/ecs/components/physicsComponents";

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
 * - FRAME: Process input, run systems (animation, transform,
 *   physics commands, camera, render), publish metrics.
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

let inputContext: InputContext | null = null;
let actionController: IActionController | null = null;
let cameraControllerSystem: CameraControllerSystem | null = null;
let isFreeCameraActive = false;
const previousActionState: ActionStateMap = new Map();

let metricsContext: MetricsContext | null = null;
let metricsFrameId = 0;

// Physics globals
let physicsCtx: PhysicsContext | null = null;
let physicsCommandSystem: PhysicsCommandSystem | null = null;
let physicsWorker: Worker | null = null;
let lastSnapshotGen = 0; // track last applied physics snapshot generation

// State for dt and camera orbit
let lastFrameTime = 0;
let animationStartTime = 0;
const orbitRadius = 15.0;
const orbitHeight = 2.0;

function applyPhysicsSnapshot(world: World, physCtx: PhysicsContext): void {
  // Check if new snapshot published
  const gen = Atomics.load(physCtx.statesI32, STATES_GEN_OFFSET >> 2);
  if (gen === lastSnapshotGen) return;
  lastSnapshotGen = gen;

  // Read which slot to consume (triple buffer)
  const writeIdx = Atomics.load(
    physCtx.statesI32,
    STATES_WRITE_INDEX_OFFSET >> 2,
  );
  if (writeIdx < 0 || writeIdx >= STATES_SLOT_COUNT) return;

  const slotBaseI32 =
    (STATES_SLOT_OFFSET >> 2) + writeIdx * (STATES_SLOT_SIZE >> 2);
  const count = Atomics.load(physCtx.statesI32, slotBaseI32);
  if (count <= 0) return;

  // Build physId → entity map from current world
  const physEntities = world.query([PhysicsBodyComponent]);
  const physToEntity = new Map<number, number>();
  for (const e of physEntities) {
    const bc = world.getComponent(e, PhysicsBodyComponent);
    if (bc?.physId) physToEntity.set(bc.physId, e);
  }

  for (let i = 0; i < count && i < STATES_MAX_BODIES; i++) {
    // Per-body record layout: [u32 physId][f32 pos3][f32 rot4] stride 32 bytes
    const idOffsetI32 = slotBaseI32 + 1 + i * 8; // 8 i32 per body
    const physId = Atomics.load(physCtx.statesI32, idOffsetI32);
    const entity = physToEntity.get(physId);
    if (!entity) continue;

    const bodyPayloadF32 =
      (STATES_SLOT_OFFSET + writeIdx * STATES_SLOT_SIZE + 8 + i * 32) >> 2;
    const px = physCtx.statesF32[bodyPayloadF32 + 0];
    const py = physCtx.statesF32[bodyPayloadF32 + 1];
    const pz = physCtx.statesF32[bodyPayloadF32 + 2];
    const rx = physCtx.statesF32[bodyPayloadF32 + 3];
    const ry = physCtx.statesF32[bodyPayloadF32 + 4];
    const rz = physCtx.statesF32[bodyPayloadF32 + 5];
    const rw = physCtx.statesF32[bodyPayloadF32 + 6];

    const t = world.getComponent(entity, TransformComponent);
    if (t) {
      t.setPosition(px, py, pz);
      t.setRotation([rx, ry, rz, rw] as unknown as Float32Array);
      t.isDirty = true;
    }
  }
}

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
    lateUpdate: () => {
      //
    },
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
      (sharedEngineStateBuffer as SharedArrayBuffer) instanceof
        SharedArrayBuffer
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
  physicsCommandSystem = new PhysicsCommandSystem(physicsCtx);

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

  (self as Worker).postMessage({ type: "READY" });
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
      );
      if (cameraTransform) {
        cameraControllerSystem.syncFromTransform(cameraTransform);
      }
    }
  }

  const cameraTransform = world.getComponent(cameraEntity, TransformComponent);

  if (isFreeCameraActive) {
    // Free camera mode
    cameraControllerSystem.update(world, dt);
  } else if (cameraTransform) {
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

  // Physics snapshot -> ECS transforms
  if (physicsCtx) {
    applyPhysicsSnapshot(world, physicsCtx);
  }

  // Drive animations (then recompute transforms)
  animationSystem(world, dt);
  transformSystem(world);

  // Physics commands
  if (physicsCommandSystem) {
    physicsCommandSystem.update(world);
  }

  cameraSystem(world);

  renderSystem(world, renderer, sceneRenderData);

  if (metricsContext && renderer) {
    let physicsTimeUs = 0;
    if (physicsCtx) {
      // Read the metric non-atomically. It's just for display. it's ok, don't worry reader
      const physicsTimeMs =
        physicsCtx.statesF32[STATES_PHYSICS_STEP_TIME_MS_OFFSET >> 2];
      physicsTimeUs = Math.round(physicsTimeMs * 1000);
    }
    publishMetrics(
      metricsContext,
      renderer.getStats(),
      dt,
      ++metricsFrameId,
      physicsTimeUs, // Pass new metric here
    );
  }

  (self as Worker).postMessage({ type: "FRAME_DONE" });
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
      (self as Worker).postMessage({ type: "FRAME_DONE" });
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
      const m = msg as SetEnvironmentMsg;
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

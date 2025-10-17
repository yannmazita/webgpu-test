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
  isMouseButtonDown,
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
  updatePreviousActionState,
  wasActionPressed,
} from "@/core/input/action";
import { animationSystem } from "@/core/ecs/systems/animationSystem";
import { createScene } from "./scene2";
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
  RaycastRequestMsg,
  MSG_RAYCAST_REQUEST,
  RaycastResponseMsg,
  MSG_RAYCAST_RESPONSE,
} from "@/core/types/worker";
import {
  createEngineStateContext as createEngineStateCtx,
  EngineStateContext as EngineStateCtx,
  syncEngineState,
  publishSnapshotFromWorld,
} from "@/core/engineState";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { vec3 } from "wgpu-matrix";
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
import { getPickRay, raycast } from "@/core/utils/raycast";
import { PlayerControllerComponent } from "@/core/ecs/components/playerControllerComponent";
import { PlayerControllerSystem } from "@/core/ecs/systems/playerControllerSystem";
import { WeaponSystem } from "@/core/ecs/systems/weaponSystem";
import { DamageSystem } from "@/core/ecs/systems/damageSystem";
import { CollisionEventSystem } from "@/core/ecs/systems/collisionEventSystem";
import { lifetimeSystem } from "@/core/ecs/systems/lifetimeSystem";
import { cameraFollowSystem } from "@/core/ecs/systems/cameraFollowSystem";
import { playerInputSystem } from "@/core/ecs/systems/playerInputSystem";
import { EventManager } from "@/core/ecs/events";
import { DeathSystem } from "@/core/ecs/systems/deathSystem";
import { InteractionSystem } from "@/core/ecs/systems/interactionSystem";
import { PickupSystem } from "@/core/ecs/systems/pickupSystem";
import { InventorySystem } from "@/core/ecs/systems/inventorySystem";
import { RespawnSystem } from "@/core/ecs/systems/respawnSystem";
import { PrefabFactory, registerPrefabs } from "@/app/prefabs";

/**
 * Main render worker script.
 *
 * This worker handles the core rendering loop, ECS systems, input processing,
 * and shared state synchronization with the main and physics threads. Its
 * receives messages from the main thread (ie INIT, FRAME, RESIZE) and
 * responds with readiness signals. All heavy computation occurs here, isolated
 * from the main thread for smooth UI performance.
 *
 * Key Flows:
 * - INIT: Sets up the renderer, ECS world, scene, and shared memory contexts.
 *   It also spawns and initializes the dedicated physics worker.
 * - FRAME: Executes the main game loop in a critical order:
 *   1.  Processes user input and updates player/camera controllers.
 *   2.  Applies the latest physics state snapshot (positions, rotations).
 *   3.  Runs gameplay systems (weapon firing, projectile updates etc).
 *   4.  Processes events from the physics worker (collisions) and applies
 *       their consequences (damage).
 *   5.  Updates core ECS state (animations, transforms).
 *   6.  Generates and enqueues new commands for the physics worker.
 *   7.  Prepares for rendering by updating camera matrices.
 *   8.  Renders the scene.
 *   9.  Publishes performance metrics.
 * - RESIZE: Updates canvas/viewport dimensions and the camera's aspect ratio.
 * - SHARED STATE: Uses multiple SharedArrayBuffers for lock-free, real-time
 *   communication:
 *   - `input`: Main thread → Worker (keyboard/mouse state).
 *   - `metrics`: Worker → Main thread (performance data for UI).
 *   - `engineState`: Main thread ↔ Worker (editor tweaks like fog/sun).
 *   - `physics`: A multi-buffer channel between this worker and the
 *     physics worker, including commands, state snapshots, raycast results,
 *     and collision events.
 *
 * Assumptions:
 * - An OffscreenCanvas is transferred from the main thread.
 * - The hosting page has COOP/COEP headers enabled for SharedArrayBuffer.
 * - No direct DOM access; all UI is handled by the main thread.
 */
let engineStateCtx: EngineStateCtx | null = null;

let renderer: Renderer | null = null;
let resourceManager: ResourceManager | null = null;
let world: World | null = null;
let sceneRenderData: SceneRenderData | null = null;

let cameraEntity = -1;

let inputContext: InputContext | null = null;
let inputReader: IInputSource | null = null;
let actionController: IActionController | null = null;
let cameraControllerSystem: CameraControllerSystem | null = null;
let playerControllerSystem: PlayerControllerSystem | null = null;
let damageSystem: DamageSystem | null = null;
let collisionEventSystem: CollisionEventSystem | null = null;
let deathSystem: DeathSystem | null = null;
let weaponSystem: WeaponSystem | null = null;
let interactionSystem: InteractionSystem | null = null;
let pickupSystem: PickupSystem | null = null;
let inventorySystem: InventorySystem | null = null;
let respawnSystem: RespawnSystem | null = null;
let prefabFactory: PrefabFactory | null = null;
let isFreeCameraActive = false;
let actionMap: ActionMapConfig | null = null;
const previousActionState: ActionStateMap = new Map();
let metricsContext: MetricsContext | null = null;
let metricsFrameId = 0;

// Event Manager
let eventManager: EventManager | null = null;

// Physics globals
let physicsCtx: PhysicsContext | null = null;
let raycastResultsCtx: { i32: Int32Array; f32: Float32Array } | null = null;
let interactionRaycastResultsCtx: { i32: Int32Array } | null = null;
let physicsCommandSystem: PhysicsCommandSystem | null = null;
let physicsWorker: Worker | null = null;
let lastSnapshotGen = 0; // track last applied physics snapshot generation

// State for raycast
let lastViewportWidth = 0;
let lastViewportHeight = 0;

// State for dt
let lastFrameTime = 0;

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
    // Per-body record layout: [u32 physId][f32 pos3][f32 rot4][f32 onGround] stride 36 bytes
    // Stride is 36 bytes = 9 elements of 32-bits
    const recordBaseI32 = slotBaseI32 + 1 + i * 9;
    const physId = Atomics.load(physCtx.statesI32, recordBaseI32);
    const entity = physToEntity.get(physId);
    if (!entity) continue;

    const payloadF32 = recordBaseI32 + 1;
    const px = physCtx.statesF32[payloadF32 + 0];
    const py = physCtx.statesF32[payloadF32 + 1];
    const pz = physCtx.statesF32[payloadF32 + 2];
    const rx = physCtx.statesF32[payloadF32 + 3];
    const ry = physCtx.statesF32[payloadF32 + 4];
    const rz = physCtx.statesF32[payloadF32 + 5];
    const rw = physCtx.statesF32[payloadF32 + 6];
    const onGround = physCtx.statesF32[payloadF32 + 7];

    const t = world.getComponent(entity, TransformComponent);
    if (t) {
      t.setPosition(px, py, pz);
      t.setRotation([rx, ry, rz, rw] as unknown as Float32Array);
      t.isDirty = true;
    }

    // Apply onGround status to player controller
    const playerController = world.getComponent(
      entity,
      PlayerControllerComponent,
    );
    if (playerController) {
      playerController.onGround = onGround > 0.5;
    }
  }
}

/**
 * Initializes the render worker.
 *
 * @remarks
 * This function orchestrates the entire setup process for the render worker.
 * It initializes the WebGPU renderer, sets up all shared memory contexts
 * (input, metrics, engine state, physics), creates the ECS world and systems
 * and spawns the physics worker, passing it the necessary shared buffers.
 *
 * @param offscreen - OffscreenCanvas for WebGPU rendering.
 * @param sharedInputBuffer - SharedArrayBuffer for input state.
 * @param sharedMetricsBuffer - SharedArrayBuffer for performance metrics.
 * @param sharedEngineStateBuffer - SharedArrayBuffer for editor state sync.
 * @param sharedRaycastResultsBuffer - SharedArrayBuffer for weapon raycast results.
 * @param sharedCollisionEventsBuffer - SharedArrayBuffer for physics collision events.
 * @param sharedCharControllerEventsBuffer - SharedArrayBuffer for character controller events.
 * @returns A promise that resolves when initialization is complete.
 */
async function initWorker(
  offscreen: OffscreenCanvas,
  sharedInputBuffer: SharedArrayBuffer,
  sharedMetricsBuffer: SharedArrayBuffer,
  sharedEngineStateBuffer: SharedArrayBuffer,
  sharedRaycastResultsBuffer: SharedArrayBuffer,
  sharedInteractionRaycastResultsBuffer: SharedArrayBuffer,
  sharedCollisionEventsBuffer: SharedArrayBuffer,
  sharedCharControllerEventsBuffer: SharedArrayBuffer,
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
  inputReader = {
    isKeyDown: (code: string) => isKeyDown(inputContext!, code),
    isMouseButtonDown: (button: number) =>
      isMouseButtonDown(inputContext!, button),
    getMouseDelta: () => getAndResetMouseDelta(inputContext!),
    getMousePosition: () => getMousePosition(inputContext!),
    isPointerLocked: () => isPointerLocked(inputContext!),
    lateUpdate: () => {
      //
    },
  };

  actionMap = {
    move_vertical: { type: "axis", positiveKey: "KeyW", negativeKey: "KeyS" },
    move_horizontal: { type: "axis", positiveKey: "KeyD", negativeKey: "KeyA" },
    move_y_axis: {
      type: "axis",
      positiveKey: "Space",
      negativeKey: "ShiftLeft",
    },
    toggle_camera_mode: { type: "button", keys: ["KeyC"] },
    jump: { type: "button", keys: ["Space"] },
    fire: { type: "button", mouseButtons: [0] }, // 0 = Left Mouse Button
    interact: { type: "button", keys: ["KeyE"] },
  };

  actionController = {
    isPressed: (name: string) => isActionPressed(actionMap, inputReader, name),
    wasPressed: (name: string) =>
      wasActionPressed(actionMap, inputReader, name, previousActionState),
    getAxis: (name: string) => getAxisValue(actionMap, inputReader, name),
    getMouseDelta: () => inputReader.getMouseDelta(),
    isPointerLocked: () => inputReader.isPointerLocked(),
  };

  // Event Manager Setup
  eventManager = new EventManager();

  // Engine editor state: validate buffer before using
  try {
    if (
      sharedEngineStateBuffer &&
      sharedEngineStateBuffer instanceof SharedArrayBuffer
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

  // --- Prefab Factory Setup ---
  // Must be created AFTER world and resourceManager
  prefabFactory = new PrefabFactory(world, resourceManager);
  registerPrefabs(prefabFactory);

  // --- Scene Setup ---
  try {
    console.log("[Worker] Creating default scene...");
    const sceneEntities = await createScene(world, resourceManager);
    cameraEntity = sceneEntities.cameraEntity;
    console.log("[Worker] Scene created successfully");
  } catch (error) {
    console.error("[Worker] Failed to create scene:", error);
    throw error;
  }

  // --- Physics Setup ---
  console.log("[Worker] Setting up physics...");
  const commandsBuffer = new SharedArrayBuffer(COMMANDS_BUFFER_SIZE);
  const statesBuffer = new SharedArrayBuffer(STATES_BUFFER_SIZE);
  physicsCtx = createPhysicsContext(
    commandsBuffer,
    statesBuffer,
    sharedCollisionEventsBuffer,
    sharedCharControllerEventsBuffer,
  );
  initializePhysicsHeaders(physicsCtx);

  // Create context for weapon raycast results (managed separately)
  raycastResultsCtx = {
    i32: new Int32Array(sharedRaycastResultsBuffer),
    f32: new Float32Array(sharedRaycastResultsBuffer),
  };

  // Create context for interaction raycast results (managed separately)
  interactionRaycastResultsCtx = {
    i32: new Int32Array(sharedInteractionRaycastResultsBuffer),
  };

  // Create physics worker
  physicsWorker = new Worker(
    new URL("./physicsWorker/physicsWorker.ts", import.meta.url),
    {
      type: "module",
    },
  );

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
    raycastResultsBuffer: sharedRaycastResultsBuffer,
    collisionEventsBuffer: sharedCollisionEventsBuffer,
    interactionRaycastResultsBuffer: sharedInteractionRaycastResultsBuffer,
    charControllerEventsBuffer: sharedCharControllerEventsBuffer,
  };
  physicsWorker.postMessage(initMsg);

  // Create command system
  physicsCommandSystem = new PhysicsCommandSystem(physicsCtx);

  // Player controller system must be created AFTER physics context
  playerControllerSystem = new PlayerControllerSystem(
    actionController,
    physicsCtx,
  );

  // Damage system for processing all damage events
  damageSystem = new DamageSystem(eventManager);

  // Interaction System
  interactionSystem = new InteractionSystem(
    world,
    actionController,
    eventManager,
    physicsCtx,
    interactionRaycastResultsCtx,
  );

  // Pickup System
  pickupSystem = new PickupSystem(world, eventManager);

  // Inventory System
  inventorySystem = new InventorySystem(world, eventManager);

  // Weapon System
  if (resourceManager) {
    weaponSystem = new WeaponSystem(
      world,
      resourceManager,
      physicsCtx,
      raycastResultsCtx,
      damageSystem,
      eventManager,
    );
  }

  // Create the system for handling physics collision events.
  collisionEventSystem = new CollisionEventSystem(
    world,
    physicsCtx,
    eventManager,
    damageSystem,
  );

  // Create the system for handling death events.
  deathSystem = new DeathSystem(world, eventManager);

  // Create the respawn system
  respawnSystem = new RespawnSystem(world, eventManager, prefabFactory);

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

  self.postMessage({ type: "READY" });
}

/**
 * Main frame update loop for the render worker.
 *
 * @remarks
 * This function orchestrates all per-frame activity. The execution order is
 * critical for data consistency:
 * 1.  Sync state from editor and apply the latest physics snapshot.
 * 2.  Run input-driven controllers and the input-to-event system.
 * 3.  Run gameplay systems (`weaponSystem` cooldowns, `damageSystem` queue).
 * 4.  Process all queued events via `eventManager.update()`. This triggers
 *     reactive logic like firing weapons and handling deaths.
 * 5.  Run core ECS systems (`animation`, `transform`, `physicsCommands`, `camera`).
 * 6.  Render the scene.
 * 7.  Publish metrics.
 *
 * @param now - The current high-resolution timestamp from `requestAnimationFrame`.
 */
function frame(now: number): void {
  // --- Guard Clause ---
  if (
    !renderer ||
    !world ||
    !sceneRenderData ||
    !cameraControllerSystem ||
    !actionController ||
    !playerControllerSystem ||
    !damageSystem ||
    !collisionEventSystem ||
    !deathSystem ||
    !eventManager ||
    !actionMap ||
    !interactionSystem ||
    !pickupSystem ||
    !inventorySystem ||
    !respawnSystem
  ) {
    self.postMessage({ type: "FRAME_DONE" });
    return;
  }

  // --- State Synchronization (Editor -> Worker) ---
  if (engineStateCtx) {
    syncEngineState(world, engineStateCtx);
  }

  // --- Delta Time Calculation ---
  const MAX_PAUSE_SECONDS = 0.5;
  let dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 0;
  lastFrameTime = now;
  if (dt > MAX_PAUSE_SECONDS) {
    dt = MAX_PAUSE_SECONDS;
  }

  // --- Input Processing & Camera Mode ---
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

  // --- Controller Updates ---
  if (isFreeCameraActive) {
    cameraControllerSystem.update(world, dt);
  } else {
    playerControllerSystem.update(world, dt);
  }

  // --- Input to Intent System ---
  playerInputSystem(world, actionController, eventManager);

  // --- State Synchronization (Physics -> Worker) ---
  if (physicsCtx) {
    applyPhysicsSnapshot(world, physicsCtx);
  }

  // --- Gameplay Systems ---
  interactionSystem.update(); // Must run before event manager
  weaponSystem?.update(dt);
  lifetimeSystem(world, dt);
  collisionEventSystem.update();
  damageSystem.update(world);
  respawnSystem.update(now);

  // Process all queued events (ie DeathEvent, FireWeaponEvent, InteractEvent)
  eventManager.update();

  // --- Core ECS System Execution Order ---
  animationSystem(world, dt);
  transformSystem(world);

  // Only run the camera follow system when not in free camera mode.
  if (!isFreeCameraActive) {
    cameraFollowSystem(world);
  }

  if (physicsCommandSystem) {
    physicsCommandSystem.update(world);
  }
  cameraSystem(world);
  renderSystem(world, renderer, sceneRenderData);

  // --- Input State Update (for next frame's input) ---
  updatePreviousActionState(actionController, previousActionState, actionMap);

  // --- Performance Metrics ---
  if (metricsContext && renderer) {
    let physicsTimeUs = 0;
    if (physicsCtx) {
      const physicsTimeMs =
        physicsCtx.statesF32[STATES_PHYSICS_STEP_TIME_MS_OFFSET >> 2];
      physicsTimeUs = Math.round(physicsTimeMs * 1000);
    }
    publishMetrics(
      metricsContext,
      renderer.getStats(),
      dt,
      ++metricsFrameId,
      physicsTimeUs,
    );
  }

  // --- Signal to Main Thread ---
  self.postMessage({ type: "FRAME_DONE" });
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
    | InitMsg
    | ResizeMsg
    | FrameMsg
    | ToneMapMsg
    | SetEnvironmentMsg
    | RaycastRequestMsg
  >,
) => {
  const msg = ev.data;

  if (msg.type === MSG_INIT) {
    await initWorker(
      msg.canvas,
      msg.sharedInputBuffer,
      msg.sharedMetricsBuffer,
      msg.sharedEngineStateBuffer,
      msg.sharedRaycastResultsBuffer,
      msg.sharedInteractionRaycastResultsBuffer,
      msg.sharedCollisionEventsBuffer,
      msg.sharedCharControllerEventsBuffer,
    );
    return;
  }

  if (!renderer || !world) {
    if (msg.type === MSG_FRAME) {
      self.postMessage({ type: "FRAME_DONE" });
    }
    return;
  }

  switch (msg.type) {
    case MSG_RESIZE: {
      // Store the viewport dimensions for later use by raycasting.
      lastViewportWidth = msg.cssWidth;
      lastViewportHeight = msg.cssHeight;

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
      const m = msg;
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
    case MSG_RAYCAST_REQUEST: {
      console.log("[Worker] Received raycast request:", msg);
      const m = msg;
      const cam =
        cameraEntity !== -1
          ? world.getComponent(cameraEntity, CameraComponent)
          : undefined;
      if (cam) {
        const camPos = vec3.fromValues(
          cam.inverseViewMatrix[12],
          cam.inverseViewMatrix[13],
          cam.inverseViewMatrix[14],
        );
        console.log(
          `[Worker] Camera position: ${camPos[0].toFixed(2)}, ${camPos[1].toFixed(2)}, ${camPos[2].toFixed(2)}`,
        );

        const { origin, direction } = getPickRay(
          { x: m.x, y: m.y },
          lastViewportWidth,
          lastViewportHeight,
          cam,
        );
        console.log(
          `[Worker] Generated Ray -> Origin: [${origin[0].toFixed(2)}, ${origin[1].toFixed(2)}, ${origin[2].toFixed(2)}], Direction: [${direction[0].toFixed(2)}, ${direction[1].toFixed(2)}, ${direction[2].toFixed(2)}]`,
        );

        const hit = raycast(world, origin, direction);
        console.log("[Worker] Raycast hit:", hit);

        let responseHit = null;
        if (hit) {
          responseHit = {
            ...hit,
            entityName: world.getEntityName(hit.entity),
          };
        }

        const response: RaycastResponseMsg = {
          type: MSG_RAYCAST_RESPONSE,
          hit: responseHit,
        };
        self.postMessage(response);
      }
      break;
    }
  }
};

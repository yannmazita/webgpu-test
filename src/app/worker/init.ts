// src/app/worker/init.ts
import { state } from "@/app/worker/state";
import { Renderer } from "@/core/rendering/renderer";
import { ResourceManager } from "@/core/resources/resourceManager";
import { World } from "@/core/ecs/world";
import { SceneRenderData } from "@/core/types/rendering";
import { CameraControllerSystem } from "@/core/ecs/systems/cameraControllerSystem";
import { PlayerControllerSystem } from "@/core/ecs/systems/playerControllerSystem";
import { WeaponSystem } from "@/core/ecs/systems/weaponSystem";
import { DamageSystem } from "@/core/ecs/systems/damageSystem";
import { CollisionEventSystem } from "@/core/ecs/systems/collisionEventSystem";
import { DeathSystem } from "@/core/ecs/systems/deathSystem";
import { InteractionSystem } from "@/core/ecs/systems/interactionSystem";
import { PickupSystem } from "@/core/ecs/systems/pickupSystem";
import { InventorySystem } from "@/core/ecs/systems/inventorySystem";
import { RespawnSystem } from "@/core/ecs/systems/respawnSystem";
import { ProjectileSystem } from "@/core/ecs/systems/projectileSystem";
import { PhysicsCommandSystem } from "@/core/ecs/systems/physicsCommandSystem";
import {
  createInputContext,
  isKeyDown,
  isMouseButtonDown,
  getAndResetMouseDelta,
  getMousePosition,
  isPointerLocked,
} from "@/core/input/manager";
import {
  createEngineStateContext as createEngineStateCtx,
  publishSnapshotFromWorld,
} from "@/core/engineState";
import {
  createPhysicsContext,
  initializePhysicsHeaders,
} from "@/core/physicsState";
import {
  COMMANDS_BUFFER_SIZE,
  STATES_BUFFER_SIZE,
} from "@/core/sharedPhysicsLayout";
import { PhysicsInitMsg, PhysicsMessage } from "@/core/types/physics";
import { createScene } from "@/app/scene2";
import { PrefabFactory, registerPrefabs } from "@/app/prefabs";
import { EventManager } from "@/core/ecs/events/eventManager";
import {
  getAxisValue,
  isActionPressed,
  wasActionPressed,
} from "@/core/input/action";

/**
 * Initializes the render worker with all necessary contexts and systems.
 *
 * @remarks
 * This function orchestrates the complete setup process:
 * - Creates WebGPU renderer and resource manager
 * - Sets up shared memory contexts for input, engine state, physics etc
 * - Initializes ECS world and all game systems
 * - Spawns and configures the physics worker
 * - Creates the default scene
 *
 * @param offscreen - OffscreenCanvas for WebGPU rendering
 * @param sharedInputBuffer - SharedArrayBuffer for input state
 * @param sharedEngineStateBuffer - SharedArrayBuffer for editor state sync
 * @param sharedRaycastResultsBuffer - SharedArrayBuffer for weapon raycast results
 * @param sharedInteractionRaycastResultsBuffer - SharedArrayBuffer for interaction raycast results
 * @param sharedCollisionEventsBuffer - SharedArrayBuffer for physics collision events
 * @param sharedCharControllerEventsBuffer - SharedArrayBuffer for character controller events
 * @returns Promise that resolves when initialization is complete
 */
export async function initWorker(
  offscreen: OffscreenCanvas,
  sharedInputBuffer: SharedArrayBuffer,
  sharedEngineStateBuffer: SharedArrayBuffer,
  sharedRaycastResultsBuffer: SharedArrayBuffer,
  sharedInteractionRaycastResultsBuffer: SharedArrayBuffer,
  sharedCollisionEventsBuffer: SharedArrayBuffer,
  sharedCharControllerEventsBuffer: SharedArrayBuffer,
): Promise<void> {
  console.log("[Worker] Initializing...");

  // Initialize renderer
  state.renderer = new Renderer(offscreen);
  console.log("[Worker] Awaiting renderer init...");
  await state.renderer.init();
  console.log("[Worker] Renderer initialized.");

  // Setup input context
  state.inputContext = createInputContext(sharedInputBuffer, false);
  state.inputReader = {
    isKeyDown: (code: string) => isKeyDown(state.inputContext!, code),
    isMouseButtonDown: (button: number) =>
      isMouseButtonDown(state.inputContext!, button),
    getMouseDelta: () => getAndResetMouseDelta(state.inputContext!),
    getMousePosition: () => getMousePosition(state.inputContext!),
    isPointerLocked: () => isPointerLocked(state.inputContext!),
    lateUpdate: () => {},
  };

  // Configure action mappings
  state.actionMap = {
    move_vertical: { type: "axis", positiveKey: "KeyW", negativeKey: "KeyS" },
    move_horizontal: { type: "axis", positiveKey: "KeyD", negativeKey: "KeyA" },
    move_y_axis: {
      type: "axis",
      positiveKey: "Space",
      negativeKey: "ShiftLeft",
    },
    toggle_camera_mode: { type: "button", keys: ["KeyC"] },
    jump: { type: "button", keys: ["Space"] },
    fire: { type: "button", mouseButtons: [0] },
    interact: { type: "button", keys: ["KeyE"] },
  };

  // Create action controller
  state.actionController = {
    isPressed: (name: string) =>
      isActionPressed(state.actionMap!, state.inputReader!, name),
    wasPressed: (name: string) =>
      wasActionPressed(
        state.actionMap!,
        state.inputReader!,
        name,
        state.previousActionState,
      ),
    getAxis: (name: string) =>
      getAxisValue(state.actionMap!, state.inputReader!, name),
    getMouseDelta: () => state.inputReader!.getMouseDelta(),
    isPointerLocked: () => state.inputReader!.isPointerLocked(),
  };

  // Setup event manager
  state.eventManager = new EventManager();

  // Setup engine state context
  try {
    if (
      sharedEngineStateBuffer &&
      sharedEngineStateBuffer instanceof SharedArrayBuffer
    ) {
      state.engineStateCtx = createEngineStateCtx(sharedEngineStateBuffer);
      console.log(
        "[Worker] EngineState SAB created. i32.len=",
        state.engineStateCtx.i32.length,
        " f32.len=",
        state.engineStateCtx.f32.length,
      );
    } else {
      console.warn(
        "[Worker] sharedEngineStateBuffer missing or not a SharedArrayBuffer.",
      );
      state.engineStateCtx = null;
    }
  } catch (e) {
    console.error("[Worker] Failed to create EngineState context:", e);
    state.engineStateCtx = null;
  }

  // Create core systems
  state.cameraControllerSystem = new CameraControllerSystem(
    state.actionController,
  );
  state.resourceManager = new ResourceManager(state.renderer);
  state.world = new World();
  state.sceneRenderData = new SceneRenderData();

  // Setup prefab factory
  state.prefabFactory = new PrefabFactory(state.world, state.resourceManager);
  registerPrefabs(state.prefabFactory);

  // Create default scene
  try {
    console.log("[Worker] Creating default scene...");
    const sceneEntities = await createScene(state.world, state.resourceManager);
    state.cameraEntity = sceneEntities.cameraEntity;
    console.log("[Worker] Scene created successfully");
  } catch (error) {
    console.error("[Worker] Failed to create scene:", error);
    throw error;
  }

  // Setup physics
  console.log("[Worker] Setting up physics...");
  const commandsBuffer = new SharedArrayBuffer(COMMANDS_BUFFER_SIZE);
  const statesBuffer = new SharedArrayBuffer(STATES_BUFFER_SIZE);
  state.physicsCtx = createPhysicsContext(
    commandsBuffer,
    statesBuffer,
    sharedCollisionEventsBuffer,
    sharedCharControllerEventsBuffer,
  );
  initializePhysicsHeaders(state.physicsCtx);

  // Setup raycast contexts
  state.raycastResultsCtx = {
    i32: new Int32Array(sharedRaycastResultsBuffer),
    f32: new Float32Array(sharedRaycastResultsBuffer),
  };
  state.interactionRaycastResultsCtx = {
    i32: new Int32Array(sharedInteractionRaycastResultsBuffer),
  };

  // Create physics worker
  state.physicsWorker = new Worker(
    new URL("../physicsWorker/physicsWorker.ts", import.meta.url),
    { type: "module" },
  );

  // Listen for physics worker messages
  state.physicsWorker.addEventListener(
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

  // Initialize physics worker
  const initMsg: PhysicsInitMsg = {
    type: "INIT",
    commandsBuffer,
    statesBuffer,
    raycastResultsBuffer: sharedRaycastResultsBuffer,
    collisionEventsBuffer: sharedCollisionEventsBuffer,
    interactionRaycastResultsBuffer: sharedInteractionRaycastResultsBuffer,
    charControllerEventsBuffer: sharedCharControllerEventsBuffer,
  };
  state.physicsWorker.postMessage(initMsg);

  // Create game systems
  state.physicsCommandSystem = new PhysicsCommandSystem(state.physicsCtx);
  state.playerControllerSystem = new PlayerControllerSystem(
    state.actionController,
    state.physicsCtx,
  );
  state.damageSystem = new DamageSystem(state.eventManager);
  state.interactionSystem = new InteractionSystem(
    state.world,
    state.actionController,
    state.eventManager,
    state.physicsCtx,
    state.interactionRaycastResultsCtx,
  );
  state.pickupSystem = new PickupSystem(state.world, state.eventManager);
  state.inventorySystem = new InventorySystem(state.world, state.eventManager);

  if (state.resourceManager) {
    state.weaponSystem = new WeaponSystem(
      state.world,
      state.resourceManager,
      state.physicsCtx,
      state.raycastResultsCtx,
      state.eventManager,
    );
  }

  state.collisionEventSystem = new CollisionEventSystem(
    state.world,
    state.physicsCtx,
    state.eventManager,
  );
  state.deathSystem = new DeathSystem(state.world, state.eventManager);
  state.projectileSystem = new ProjectileSystem(
    state.world,
    state.eventManager,
    state.damageSystem,
  );
  state.respawnSystem = new RespawnSystem(
    state.world,
    state.eventManager,
    state.prefabFactory,
  );

  // Publish initial engine state snapshot
  if (state.engineStateCtx) {
    if ((state.engineStateCtx.i32.length | 0) >= 4) {
      publishSnapshotFromWorld(state.world, state.engineStateCtx);
    } else {
      console.warn(
        "[Worker] EngineState SAB too small; skipping snapshot. i32.len=",
        state.engineStateCtx.i32.length,
      );
    }
  }

  self.postMessage({ type: "READY" });
}

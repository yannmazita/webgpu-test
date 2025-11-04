// src/app/worker/init.ts
import { state } from "@/app/worker/state";
import { Renderer } from "@/core/rendering/renderer";
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
import { ResourceLoadingSystem } from "@/core/ecs/systems/ressources/resourceLoadingSystem";
import { ResourceCacheComponent } from "@/core/ecs/components/resources/resourceCacheComponent";
import { UIRenderSystem } from "@/core/ecs/systems/ui/uiRenderSystem";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import { IBLIntegrationSystem } from "@/core/ecs/systems/ressources/iblIntegrationSystem";
import { createInputContext } from "@/core/input/manager";
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
import { KeyCode } from "@/core/input/keycodes";
import { RawInputSystem } from "@/core/ecs/systems/input/rawInputSystem";
import { InputToActionSystem } from "@/core/ecs/systems/input/inputToActionSystem";
import {
  ActionMap,
  ActionMapConfig,
  ActionState,
  GamepadInput,
  Input,
  MouseButton,
  MouseInput,
} from "@/core/ecs/components/resources/inputResources";

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

  // --- Step 1: Initialize Core Renderer and Contexts ---
  state.renderer = new Renderer(offscreen);
  console.log("[Worker] Awaiting renderer init...");
  await state.renderer.init();
  console.log("[Worker] Renderer initialized.");

  // Initialize Resource Loading System
  state.resourceLoadingSystem = new ResourceLoadingSystem(state.renderer);
  await state.resourceLoadingSystem.init();

  // Initialize IBL integration system
  state.iblIntegrationSystem = new IBLIntegrationSystem();

  // Setup input context
  state.inputContext = createInputContext(sharedInputBuffer, false);

  // Configure action mappings
  const actionMapConfig: ActionMapConfig = {
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

  // --- Step 2: Initialize Physics and World Contexts ---
  // These must be created before systems that depend on them.
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

  state.world = new World();
  state.world.addResource(new ResourceCacheComponent());
  state.world.addResource(new Input<KeyCode>());
  state.world.addResource(new Input<MouseButton>());
  state.world.addResource(new MouseInput());
  state.world.addResource(new GamepadInput());
  state.world.addResource(new ActionState());
  state.world.addResource(new ActionMap(actionMapConfig));

  state.sceneRenderData = new SceneRenderData();

  // Setup raycast contexts
  state.raycastResultsCtx = {
    i32: new Int32Array(sharedRaycastResultsBuffer),
    f32: new Float32Array(sharedRaycastResultsBuffer),
  };
  state.interactionRaycastResultsCtx = {
    i32: new Int32Array(sharedInteractionRaycastResultsBuffer),
  };

  // --- Step 3: Setup Prefab Factory ---
  state.prefabFactory = new PrefabFactory(state.world);
  registerPrefabs(state.prefabFactory);

  // --- Step 4: Create All Game Systems ---
  state.rawInputSystem = new RawInputSystem();
  state.inputToActionSystem = new InputToActionSystem();

  state.cameraControllerSystem = new CameraControllerSystem(state.world);
  state.physicsCommandSystem = new PhysicsCommandSystem(state.physicsCtx);
  state.playerControllerSystem = new PlayerControllerSystem(
    state.world,
    state.physicsCtx,
  );
  state.damageSystem = new DamageSystem(state.eventManager);
  state.interactionSystem = new InteractionSystem(
    state.world,
    state.eventManager,
    state.physicsCtx,
    state.interactionRaycastResultsCtx,
  );
  state.pickupSystem = new PickupSystem(state.world, state.eventManager);
  state.inventorySystem = new InventorySystem(state.world, state.eventManager);
  state.collisionEventSystem = new CollisionEventSystem(
    state.world,
    state.physicsCtx,
    state.eventManager,
  );
  state.deathSystem = new DeathSystem(state.world, state.eventManager);
  state.respawnSystem = new RespawnSystem(
    state.world,
    state.eventManager,
    state.prefabFactory,
  );
  state.weaponSystem = new WeaponSystem(
    state.world,
    state.physicsCtx,
    state.raycastResultsCtx,
    state.eventManager,
  );
  state.projectileSystem = new ProjectileSystem(
    state.world,
    state.eventManager,
    state.damageSystem,
  );

  state.uiRenderSystem = new UIRenderSystem(
    state.renderer.device,
    new ShaderPreprocessor(),
    state.renderer.canvasFormat,
  );
  await state.uiRenderSystem.init();

  // --- Step 5: Create Default Scene ---
  // Create default scene
  try {
    console.log("[Worker] Creating default scene...");
    const sceneEntities = await createScene(
      state.world,
      state.resourceLoadingSystem,
    );
    state.cameraEntity = sceneEntities.cameraEntity;
    console.log("[Worker] Scene created successfully");
  } catch (error) {
    console.error("[Worker] Failed to create scene:", error);
    throw error;
  }

  // --- Step 6: Initialize and Start Physics Worker ---
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

  // --- Step 7: Final State Snapshot ---
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

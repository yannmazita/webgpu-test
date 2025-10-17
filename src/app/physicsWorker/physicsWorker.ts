// src/app/physicsWorker.ts
/// <reference lib="webworker" />
import {
  PhysicsInitMsg,
  PhysicsStepMsg,
  PhysicsDestroyMsg,
  PhysicsReadyMsg,
  PhysicsStepDoneMsg,
  PhysicsDestroyedMsg,
} from "@/core/types/physics";
import {
  PHYSICS_MAGIC,
  PHYSICS_VERSION,
  COMMANDS_MAGIC_OFFSET,
  COMMANDS_VERSION_OFFSET,
  COMMANDS_HEAD_OFFSET,
  COMMANDS_TAIL_OFFSET,
  COMMANDS_GEN_OFFSET,
  STATES_MAGIC_OFFSET,
  STATES_VERSION_OFFSET,
  STATES_WRITE_INDEX_OFFSET,
  STATES_READ_GEN_OFFSET,
  STATES_GEN_OFFSET,
  RAYCAST_RESULTS_MAGIC_OFFSET,
  RAYCAST_RESULTS_VERSION_OFFSET,
  RAYCAST_RESULTS_GEN_OFFSET,
  INTERACTION_RAYCAST_RESULTS_MAGIC_OFFSET,
  INTERACTION_RAYCAST_RESULTS_VERSION_OFFSET,
  INTERACTION_RAYCAST_RESULTS_GEN_OFFSET,
  COLLISION_EVENTS_MAGIC_OFFSET,
  COLLISION_EVENTS_VERSION_OFFSET,
  COLLISION_EVENTS_HEAD_OFFSET,
  COLLISION_EVENTS_TAIL_OFFSET,
  COLLISION_EVENTS_GEN_OFFSET,
  CHAR_CONTROLLER_EVENTS_MAGIC_OFFSET,
  CHAR_CONTROLLER_EVENTS_VERSION_OFFSET,
  CHAR_CONTROLLER_EVENTS_HEAD_OFFSET,
  CHAR_CONTROLLER_EVENTS_TAIL_OFFSET,
  CHAR_CONTROLLER_EVENTS_GEN_OFFSET,
  CHAR_CONTROLLER_EVENTS_VERSION,
  CHAR_CONTROLLER_EVENTS_MAGIC,
  COLLISION_EVENTS_VERSION,
  COLLISION_EVENTS_MAGIC,
  INTERACTION_RAYCAST_RESULTS_VERSION,
  INTERACTION_RAYCAST_RESULTS_MAGIC,
  RAYCAST_RESULTS_VERSION,
  RAYCAST_RESULTS_MAGIC,
} from "@/core/sharedPhysicsLayout";

import {
  initRapier,
  getRapierModule,
  createWorld,
  isRapierReady,
} from "@/core/wasm/rapierModule";
import { state } from "@/app/physicsWorker/state";
import {
  startPhysicsLoop,
  stopPhysicsLoop,
  stepWorld,
} from "@/app/physicsWorker/loop";
import { publishSnapshot } from "@/app/physicsWorker/snapshot";

const GRAVITY = { x: 0.0, y: -9.81, z: 0.0 };

function validateHeader(
  view: Int32Array,
  magicOffset: number,
  versionOffset: number,
  expectedMagic: number,
  expectedVersion: number,
): boolean {
  return (
    Atomics.load(view, magicOffset >> 2) === expectedMagic &&
    Atomics.load(view, versionOffset >> 2) === expectedVersion
  );
}

async function initializePhysics(): Promise<void> {
  try {
    await initRapier();
    const rapierModule = getRapierModule();

    if (!isRapierReady()) {
      throw new Error("Rapier module failed to initialize");
    }

    state.world = createWorld(GRAVITY, 1 / 60);
    if (rapierModule) {
      state.eventQueue = new rapierModule.EventQueue(true);
    }

    console.log("[PhysicsWorker] Physics initialized successfully");
  } catch (error) {
    console.error("[PhysicsWorker] Initialization failed:", error);
    state.world = null;
    throw error;
  }
}

self.onmessage = async (
  ev: MessageEvent<PhysicsInitMsg | PhysicsStepMsg | PhysicsDestroyMsg>,
) => {
  const msg = ev.data;

  if (msg.type === "INIT") {
    try {
      await initializePhysics();

      if (!state.world) {
        throw new Error("Physics world creation failed");
      }

      state.commandsView = new Int32Array(msg.commandsBuffer);
      if (
        !validateHeader(
          state.commandsView,
          COMMANDS_MAGIC_OFFSET,
          COMMANDS_VERSION_OFFSET,
          PHYSICS_MAGIC,
          PHYSICS_VERSION,
        )
      ) {
        Atomics.store(
          state.commandsView,
          COMMANDS_MAGIC_OFFSET >> 2,
          PHYSICS_MAGIC,
        );
        Atomics.store(
          state.commandsView,
          COMMANDS_VERSION_OFFSET >> 2,
          PHYSICS_VERSION,
        );
        Atomics.store(state.commandsView, COMMANDS_HEAD_OFFSET >> 2, 0);
        Atomics.store(state.commandsView, COMMANDS_TAIL_OFFSET >> 2, 0);
        Atomics.store(state.commandsView, COMMANDS_GEN_OFFSET >> 2, 0);
      }

      state.statesI32 = new Int32Array(msg.statesBuffer);
      state.statesF32 = new Float32Array(msg.statesBuffer);
      if (
        !validateHeader(
          state.statesI32,
          STATES_MAGIC_OFFSET,
          STATES_VERSION_OFFSET,
          PHYSICS_MAGIC,
          PHYSICS_VERSION,
        )
      ) {
        Atomics.store(state.statesI32, STATES_MAGIC_OFFSET >> 2, PHYSICS_MAGIC);
        Atomics.store(
          state.statesI32,
          STATES_VERSION_OFFSET >> 2,
          PHYSICS_VERSION,
        );
        Atomics.store(state.statesI32, STATES_WRITE_INDEX_OFFSET >> 2, 0);
        Atomics.store(state.statesI32, STATES_READ_GEN_OFFSET >> 2, 0);
        Atomics.store(state.statesI32, STATES_GEN_OFFSET >> 2, 0);
      }

      state.raycastResultsI32 = new Int32Array(msg.raycastResultsBuffer);
      state.raycastResultsF32 = new Float32Array(msg.raycastResultsBuffer);
      Atomics.store(
        state.raycastResultsI32,
        RAYCAST_RESULTS_MAGIC_OFFSET >> 2,
        RAYCAST_RESULTS_MAGIC,
      );
      Atomics.store(
        state.raycastResultsI32,
        RAYCAST_RESULTS_VERSION_OFFSET >> 2,
        RAYCAST_RESULTS_VERSION,
      );
      Atomics.store(
        state.raycastResultsI32,
        RAYCAST_RESULTS_GEN_OFFSET >> 2,
        0,
      );

      state.interactionRaycastResultsI32 = new Int32Array(
        msg.interactionRaycastResultsBuffer,
      );
      Atomics.store(
        state.interactionRaycastResultsI32,
        INTERACTION_RAYCAST_RESULTS_MAGIC_OFFSET >> 2,
        INTERACTION_RAYCAST_RESULTS_MAGIC,
      );
      Atomics.store(
        state.interactionRaycastResultsI32,
        INTERACTION_RAYCAST_RESULTS_VERSION_OFFSET >> 2,
        INTERACTION_RAYCAST_RESULTS_VERSION,
      );
      Atomics.store(
        state.interactionRaycastResultsI32,
        INTERACTION_RAYCAST_RESULTS_GEN_OFFSET >> 2,
        0,
      );

      state.collisionEventsI32 = new Int32Array(msg.collisionEventsBuffer);
      state.collisionEventsF32 = new Float32Array(msg.collisionEventsBuffer);
      Atomics.store(
        state.collisionEventsI32,
        COLLISION_EVENTS_MAGIC_OFFSET >> 2,
        COLLISION_EVENTS_MAGIC,
      );
      Atomics.store(
        state.collisionEventsI32,
        COLLISION_EVENTS_VERSION_OFFSET >> 2,
        COLLISION_EVENTS_VERSION,
      );
      Atomics.store(
        state.collisionEventsI32,
        COLLISION_EVENTS_HEAD_OFFSET >> 2,
        0,
      );
      Atomics.store(
        state.collisionEventsI32,
        COLLISION_EVENTS_TAIL_OFFSET >> 2,
        0,
      );
      Atomics.store(
        state.collisionEventsI32,
        COLLISION_EVENTS_GEN_OFFSET >> 2,
        0,
      );

      state.charControllerEventsI32 = new Int32Array(
        msg.charControllerEventsBuffer,
      );
      state.charControllerEventsF32 = new Float32Array(
        msg.charControllerEventsBuffer,
      );
      Atomics.store(
        state.charControllerEventsI32,
        CHAR_CONTROLLER_EVENTS_MAGIC_OFFSET >> 2,
        CHAR_CONTROLLER_EVENTS_MAGIC,
      );
      Atomics.store(
        state.charControllerEventsI32,
        CHAR_CONTROLLER_EVENTS_VERSION_OFFSET >> 2,
        CHAR_CONTROLLER_EVENTS_VERSION,
      );
      Atomics.store(
        state.charControllerEventsI32,
        CHAR_CONTROLLER_EVENTS_HEAD_OFFSET >> 2,
        0,
      );
      Atomics.store(
        state.charControllerEventsI32,
        CHAR_CONTROLLER_EVENTS_TAIL_OFFSET >> 2,
        0,
      );
      Atomics.store(
        state.charControllerEventsI32,
        CHAR_CONTROLLER_EVENTS_GEN_OFFSET >> 2,
        0,
      );

      startPhysicsLoop();
      postMessage({ type: "READY" } as PhysicsReadyMsg);
    } catch (e) {
      const error = e as Error;
      console.error("[PhysicsWorker] Init failed:", error);
      postMessage({ type: "ERROR", error: String(error?.message) });
    }
    return;
  }

  if (!state.world) return;

  switch (msg.type) {
    case "STEP": {
      const steps = msg.steps ?? 1;
      for (let i = 0; i < steps; i++) {
        stepWorld(1 / 60);
        publishSnapshot();
      }
      postMessage({
        type: "STEP_DONE",
        steps,
        log: `Completed ${steps} steps; bodies=${state.entityToBody.size}`,
      } as PhysicsStepDoneMsg);
      break;
    }
    case "DESTROY":
      stopPhysicsLoop();
      postMessage({ type: "DESTROYED" } as PhysicsDestroyedMsg);
      break;
  }
};

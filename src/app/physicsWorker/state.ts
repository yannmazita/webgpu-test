// src/app/physicsWorker/state.ts
import {
  World,
  RigidBody,
  KinematicCharacterController,
  EventQueue,
} from "@/core/wasm/rapierModule";

export interface PhysicsWorkerState {
  // Core simulation
  world: World | null;
  eventQueue: EventQueue | null;

  // Shared buffers
  commandsView: Int32Array | null;
  statesI32: Int32Array | null;
  statesF32: Float32Array | null;
  raycastResultsI32: Int32Array | null;
  raycastResultsF32: Float32Array | null;
  interactionRaycastResultsI32: Int32Array | null;
  collisionEventsI32: Int32Array | null;
  collisionEventsF32: Float32Array | null;
  charControllerEventsI32: Int32Array | null;
  charControllerEventsF32: Float32Array | null;

  // Entity mappings
  entityToBody: Map<number, RigidBody>;
  entityToController: Map<number, KinematicCharacterController>;
  playerOnGround: Map<number, number>;
  playerSliding: Map<number, boolean>;
  bodyToEntity: WeakMap<RigidBody, number>;

  // Loop state
  accumulator: number;
  stepCounter: number;
  lastStepTimeMs: number;
  stepInterval: number | null;
}

export const state: PhysicsWorkerState = {
  world: null,
  eventQueue: null,
  commandsView: null,
  statesI32: null,
  statesF32: null,
  raycastResultsI32: null,
  raycastResultsF32: null,
  interactionRaycastResultsI32: null,
  collisionEventsI32: null,
  collisionEventsF32: null,
  charControllerEventsI32: null,
  charControllerEventsF32: null,
  entityToBody: new Map(),
  entityToController: new Map(),
  playerOnGround: new Map(),
  playerSliding: new Map(),
  bodyToEntity: new WeakMap(),
  accumulator: 0,
  stepCounter: 0,
  lastStepTimeMs: 0.0,
  stepInterval: null,
};

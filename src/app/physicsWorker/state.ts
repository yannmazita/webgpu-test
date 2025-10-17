// src/app/physicsWorker/state.ts
import {
  World,
  RigidBody,
  KinematicCharacterController,
  EventQueue,
} from "@/core/wasm/rapierModule";

/**
 * Centralized state container for the physics worker.
 *
 * @remarks
 * Encapsulates all shared buffers, entity mappings, and loop state
 * to avoid global variables and provide clear ownership boundaries.
 */
export interface PhysicsWorkerState {
  // Core simulation
  /** Core physics simulation world */
  world: World | null;
  /** Event queue for capturing collision events */
  eventQueue: EventQueue | null;

  // Shared buffers
  /** Shared command ring buffer view */
  commandsView: Int32Array | null;
  /** Shared state buffer views (int32 header) */
  statesI32: Int32Array | null;
  /** Shared state buffer views (float32 payload) */
  statesF32: Float32Array | null;
  /** Weapon raycast results buffer views */
  raycastResultsI32: Int32Array | null;
  /** Weapon raycast results buffer views */
  raycastResultsF32: Float32Array | null;
  /** Interaction raycast results buffer views */
  interactionRaycastResultsI32: Int32Array | null;
  /** Collision events buffer views */
  collisionEventsI32: Int32Array | null;
  /** Collision events buffer views */
  collisionEventsF32: Float32Array | null;
  /** Character controller events buffer views */
  charControllerEventsI32: Int32Array | null;
  /** Character controller events buffer views */
  charControllerEventsF32: Float32Array | null;

  // Entity mappings
  /** Maps physics IDs to Rapier rigid bodies */
  entityToBody: Map<number, RigidBody>;
  /** Maps physics IDs to character controllers */
  entityToController: Map<number, KinematicCharacterController>;
  /** Tracks ground contact state for players */
  playerOnGround: Map<number, number>;
  /** Tracks sliding state for players */
  playerSliding: Map<number, boolean>;
  /** Reverse mapping from bodies to physics IDs */
  bodyToEntity: WeakMap<RigidBody, number>;

  // Loop state
  /** Time accumulator for fixed-step integration */
  accumulator: number;
  /** Counter for physics steps since initialization */
  stepCounter: number;
  /** Wall time taken by the last physics step (ms) */
  lastStepTimeMs: number;
  /** Interval handle for the physics loop */
  stepInterval: number | null;
}

/** Global state instance for the physics worker */
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

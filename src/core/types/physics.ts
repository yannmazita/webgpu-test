// src/core/types/physics.ts

/**
 * Type definitions for physics messages and records.
 *
 * Messages: For postMessage between main/render/physics workers.
 * Records: For command/state data in SABs (like StateRecord for snapshots).
 */

import type { Quat, Vec3 } from "wgpu-matrix";

// --- Message Types ---

/** Initialization message from main/render to physics worker. */
export interface PhysicsInitMsg {
  type: "INIT";
  commandsBuffer: SharedArrayBuffer;
  statesBuffer: SharedArrayBuffer;
  raycastResultsBuffer: SharedArrayBuffer;
  collisionEventsBuffer: SharedArrayBuffer;
  interactionRaycastResultsBuffer: SharedArrayBuffer;
}

/** Step command (for testing; internal fixed-step loop used in prod). */
export interface PhysicsStepMsg {
  type: "STEP";
  steps?: number; // Optional; defaults to 1
}

/** Shutdown message. */
export interface PhysicsDestroyMsg {
  type: "DESTROY";
}

/** Worker response after init/step. */
export interface PhysicsReadyMsg {
  type: "READY";
}

/** Worker response after step (with optional log). */
export interface PhysicsStepDoneMsg {
  type: "STEP_DONE";
  steps: number;
  log?: string; // like "Sphere at [x,y,z]"
}

/** Worker response after destroy. */
export interface PhysicsDestroyedMsg {
  type: "DESTROYED";
}

/** Worker error response (like init failure). */
export interface PhysicsErrorMsg {
  type: "ERROR";
  error: string;
}

/** Union of all physics messages. */
export type PhysicsMessage =
  | PhysicsInitMsg
  | PhysicsStepMsg
  | PhysicsDestroyMsg
  | PhysicsReadyMsg
  | PhysicsStepDoneMsg
  | PhysicsDestroyedMsg
  | PhysicsErrorMsg;

/**
 * State record for a single body in snapshot (ID + pos + rot).
 * Used by render to update ECS transforms.
 */
export interface StateRecord {
  physId: number; // u32 PHYS_ID
  position: Vec3; // f32[3]
  rotation: Quat; // f32[4]
}

/**
 * Command record in ring buffer (type + id + params).
 * Params vary by type; fixed f32[12] slot.
 */
export interface CommandRecord {
  type: number; // u32 CMD_*
  physId: number; // u32 PHYS_ID
  params: Float32Array; // f32[12]: pos/rot/scale/type/etc.
}

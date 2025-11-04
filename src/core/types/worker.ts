// src/core/types/worker.ts
import { Vec3 } from "wgpu-matrix";
import { Entity } from "@/core/ecs/entity";

/**
 * Message type constant for worker initialization.
 */
export const MSG_INIT = "INIT";

/**
 * Message type constant for canvas resize events.
 */
export const MSG_RESIZE = "RESIZE";

/**
 * Message type constant to trigger a new frame render.
 */
export const MSG_FRAME = "FRAME";

/**
 * Message type constant for toggling tone mapping.
 */
export const MSG_SET_TONE_MAPPING = "SET_TONE_MAPPING";

/**
 * Message type constant for setting environment.
 */
export const MSG_SET_ENVIRONMENT = "SET_ENVIRONMENT";

export const MSG_RAYCAST_REQUEST = "RAYCAST_REQUEST";
export const MSG_RAYCAST_RESPONSE = "RAYCAST_RESPONSE";

/**
 * Defines the message structure for initializing the render worker.
 */
export interface InitMsg {
  /** The message type, must be `MSG_INIT`. */
  type: typeof MSG_INIT;
  /** The `OffscreenCanvas` to transfer to the worker. */
  canvas: OffscreenCanvas;
  /** The `SharedArrayBuffer` for user input. */
  sharedInputBuffer: SharedArrayBuffer;
  /** The `SharedArrayBuffer` for engine state controlled by the UI. */
  sharedEngineStateBuffer: SharedArrayBuffer;
  /** The `SharedArrayBuffer` for receiving raycast hit results from the physics worker. */
  sharedRaycastResultsBuffer: SharedArrayBuffer;
  /** The `SharedArrayBuffer` for receiving interaction raycast hit results from the physics worker. */
  sharedInteractionRaycastResultsBuffer: SharedArrayBuffer;
  /** The `SharedArrayBuffer` for collision events */
  sharedCollisionEventsBuffer: SharedArrayBuffer;
  /** The `SharedArrayBuffer` for character controller events */
  sharedCharControllerEventsBuffer: SharedArrayBuffer;
}

/**
 * Defines the message structure for notifying the worker of a canvas resize.
 */
export interface ResizeMsg {
  /** The message type, must be `MSG_RESIZE`. */
  type: typeof MSG_RESIZE;
  /** The new CSS width of the canvas. */
  cssWidth: number;
  /** The new CSS height of the canvas. */
  cssHeight: number;
  /** The current device pixel ratio of the screen. */
  devicePixelRatio: number;
}

/**
 * Defines the message structure for notifying the worker to render a new frame.
 */
export interface FrameMsg {
  /** The message type, must be `MSG_FRAME`. */
  type: typeof MSG_FRAME;
  /** The current timestamp from `requestAnimationFrame`. */
  now: number;
}

/**
 * Defines the message structure for toggling the tone mapping post-processing
 * effect.
 */
export interface ToneMapMsg {
  /** The message type, must be `MSG_SET_TONE_MAPPING`. */
  type: typeof MSG_SET_TONE_MAPPING;
  /** Whether tone mapping should be enabled. */
  enabled: boolean;
}

export interface SetEnvironmentMsg {
  type: typeof MSG_SET_ENVIRONMENT;
  url: string;
  size: number;
}

export interface RaycastRequestMsg {
  type: typeof MSG_RAYCAST_REQUEST;
  x: number;
  y: number;
}

export interface RaycastResponseMsg {
  type: typeof MSG_RAYCAST_RESPONSE;
  hit: {
    entity: Entity;
    entityName: string;
    distance: number;
    point: Vec3;
  } | null;
}

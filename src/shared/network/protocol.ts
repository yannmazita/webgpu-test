// src/shared/network/protocol.ts

import { Vec3, Quat } from "wgpu-matrix";

// A stable network identifier for an entity.
export type NetId = number;
// A unique identifier for a connected client.
export type ClientId = number;

/**
 * Defines the types of messages exchanged between client and server.
 */
export enum MessageType {
  // Client -> Server
  CLIENT_HELLO = 0,
  PLAYER_INPUT = 1,
  CLIENT_COMMAND = 2, // ie request to interact, change weapon

  // Server -> Client
  SERVER_HELLO = 10,
  WORLD_SNAPSHOT = 11,
  ENTITY_SPAWN = 12,
  ENTITY_DESPAWN = 13,
  EVENT_NOTIFICATION = 14, // For reliable, one-off game events

  // Bidirectional
  PING = 20,
  PONG = 21,
}

/**
 * Message sent from client to server containing player inputs for a given tick.
 * This is designed to be compact for sending at a high rate.
 */
export interface PlayerInputMessage {
  type: MessageType.PLAYER_INPUT;
  /** Client's simulation tick for this input, used for reconciliation. */
  tick: number;
  /** Time delta for this input on the client, used for server-side physics. */
  deltaTime: number;
  /** Bitmask of pressed action buttons (ie jump, fire). */
  buttonMask: number;
  /** Horizontal movement axis value [-1.0, 1.0]. */
  moveHorizontal: number;
  /** Vertical movement axis value [-1.0, 1.0]. */
  moveVertical: number;
  /** Player's view pitch in radians. */
  pitch: number;
  /** Player's view yaw in radians. */
  yaw: number;
}

/**
 * A snapshot of a single entity's state at a specific server tick.
 */
export interface EntitySnapshot {
  netId: NetId;
  /** Bitmask indicating which components are included in this snapshot. */
  componentMask: number;
  // --- Component Data (optional, based on mask) ---
  position?: Vec3;
  rotation?: Quat;
  velocity?: Vec3;
  health?: number;
}

/**
 * Message sent from server to clients containing the state of all relevant entities.
 */
export interface WorldSnapshotMessage {
  type: MessageType.WORLD_SNAPSHOT;
  /** The server tick this snapshot corresponds to. */
  tick: number;
  /** The server timestamp when the snapshot was generated. */
  timestamp: number;
  /** An array of all entity states in the snapshot. */
  entities: EntitySnapshot[];
}

// A union type for all possible messages for type-safe handling.
export type NetworkMessage =
  | PlayerInputMessage
  | WorldSnapshotMessage
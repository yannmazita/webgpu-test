// src/shared/ecs/events/damageEvents.ts
import { Entity } from "@/shared/ecs/entity";
import { Vec3 } from "wgpu-matrix";

/** Fired when the player's ground state changes. */
export interface GroundStateChangedEvent {
  entity: Entity;
  /** True if now grounded, false if now airborne. */
  isGrounded: boolean;
  /** Optional: the entity the character is standing on. */
  groundEntity?: Entity;
}

/** Fired when the controller hits a wall. */
export interface WallContactEvent {
  entity: Entity;
  /** Normal of the wall surface. */
  wallNormal: Vec3;
  /** The wall entity, if any. */
  wallEntity?: Entity;
}

/** Fired when the controller climbs a step. */
export interface StepClimbedEvent {
  entity: Entity;
  stepHeight: number;
}

/** Fired when the character hits a ceiling. */
export interface CeilingHitEvent {
  entity: Entity;
  ceilingEntity?: Entity;
}

/** Fired when the character starts/stops sliding. */
export interface SlidingStateChangedEvent {
  entity: Entity;
  isSliding: boolean;
}

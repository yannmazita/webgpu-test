// src/core/ecs/events/collisionEvents.ts
import { Entity } from "@/core/ecs/entity";
import { Vec3 } from "wgpu-matrix";

/** Fired when two physics bodies start colliding. */
export interface CollisionStartedEvent {
  entityA: Entity;
  entityB: Entity;
  contactPoint: Vec3;
  normal: Vec3;
  impulse: number;
  penetration: number;
}

/** Fired when two physics bodies stop colliding. */
export interface CollisionEndedEvent {
  entityA: Entity;
  entityB: Entity;
}

/** Fired when a sensor volume detects entry. */
export interface SensorEnteredEvent {
  sensor: Entity;
  other: Entity;
}

/** Fired when a sensor volume detects exit. */
export interface SensorExitedEvent {
  sensor: Entity;
  other: Entity;
}

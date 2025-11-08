// src/shared/ecs/events/physicsEvents.ts
import { Entity } from "@/shared/ecs/entity";
import { Vec3 } from "wgpu-matrix";

/**
 * Fired when a dynamic body goes to sleep (optimization event).
 */
export interface BodySleptEvent {
  entity: Entity;
}

/** Fired when a sleeping body wakes up. */
export interface BodyWokeEvent {
  entity: Entity;
}

/**
 * Fired when a body's velocity crosses a threshold.
 * @remarks
 * Useful for landing impact detection.
 */
export interface VelocityThresholdEvent {
  entity: Entity;
  velocity: Vec3;
  speed: number;
}

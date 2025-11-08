// src/shared/ecs/events/damageEvents.ts
import { Entity } from "@/shared/ecs/entity";
import { Vec3 } from "wgpu-matrix";

/**
 * Fired when an entity takes damage (before health is reduced).
 */
export interface DamageTakenEvent {
  target: Entity;
  amount: number;
  source?: Entity;
  damagePoint?: Vec3;
}

/**
 * Fired when an entity deals damage to another.
 */
export interface DamageDealtEvent {
  source: Entity;
  target: Entity;
  amount: number;
}

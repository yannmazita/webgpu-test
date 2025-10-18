// src/core/ecs/events/commonEvents.ts
import { Entity } from "@/core/ecs/entity";

/**
 * Represents the data payload for a death event.
 * @remarks
 * This event is published when an entity's health is reduced to zero.
 * It contains information about the victim and the source of the fatal damage.
 */
export interface DeathEvent {
  victim: Entity;
  killer?: Entity;
}

/**
 * Fired when the player's interaction target changes.
 * @remarks
 * Used to update UI prompts.
 */
export interface InteractionTargetChangedEvent {
  newTarget: Entity | null;
  prompt: string | null;
}

/** Fired when a player actively interacts with a target. */
export interface InteractEvent {
  interactor: Entity;
  target: Entity;
}

/** Request to add an item to inventory. */
export interface AddToInventoryEvent {
  entity: Entity;
  itemId: string;
  quantity: number;
}

/** Fired when inventory contents change. */
export interface InventoryUpdatedEvent {
  owner: Entity;
}

/** Request to respawn an entity. */
export interface RequestRespawnEvent {
  prefabId: string;
  respawnTime: number;
  spawnPointTag?: string;
}

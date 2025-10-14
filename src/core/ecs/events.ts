// src/core/ecs/events.ts
import { Entity } from "@/core/ecs/entity";

/**
 * Defines the core event management system for the ECS.
 * This allows for decoupled communication between systems.
 */

/**
 * Represents the data payload for a death event.
 * @remarks
 * This event is published when an entity's health is reduced to zero.
 * It contains information about the victim and the source of the fatal damage.
 */
export interface DeathEvent {
  /** The entity that was defeated. */
  victim: Entity;
  /** The entity responsible for the death, if known. */
  killer?: Entity;
}

/**
 * Represents the data payload for a fire weapon event.
 * @remarks
 * This event is published when an entity intends to fire its equipped weapon.
 */
export interface FireWeaponEvent {
  /** The entity that is firing the weapon. */
  shooter: Entity;
}

/**
 * Payload for when the player's interaction target changes.
 * Used to update UI prompts.
 */
export interface InteractionTargetChangedEvent {
  newTarget: Entity | null;
  prompt: string | null;
}

/**
 * Payload for when the player actively interacts with a target.
 */
export interface InteractEvent {
  interactor: Entity;
  target: Entity;
}

/**
 * Payload to request adding an item to an inventory.
 * Processed by the InventorySystem.
 */
export interface AddToInventoryEvent {
  /** The entity whose inventory should be modified. */
  entity: Entity;
  itemId: string;
  quantity: number;
}

/**
 * Payload for when an inventory has been updated.
 * Used to update UI.
 */
export interface InventoryUpdatedEvent {
  owner: Entity;
}

/**
 * Represents the data payload to request that an entity be respawned.
 * @remarks
 * This event is published by the `DeathSystem` when an entity with a
 * `RespawnComponent` is destroyed. It is consumed by the `RespawnSystem`,
 * which then manages the respawn timer and subsequent entity creation.
 */
export interface RequestRespawnEvent {
  /** The identifier for the prefab used to recreate the entity. */
  prefabId: string;
  /** The time in seconds to wait before respawning. */
  respawnTime: number;
  /** An optional tag for selecting a specific group of spawn points. */
  spawnPointTag?: string;
}

/**
 * A union of all possible event payloads.
 */
export type GameEventPayload =
  | DeathEvent
  | FireWeaponEvent
  | InteractionTargetChangedEvent
  | InteractEvent
  | AddToInventoryEvent
  | InventoryUpdatedEvent
  | RequestRespawnEvent;

/**
 * A discriminated union of all possible game events, using a 'type' property.
 */
export type GameEvent =
  | { type: "death"; payload: DeathEvent }
  | { type: "fire-weapon"; payload: FireWeaponEvent }
  | {
      type: "interaction-target-changed";
      payload: InteractionTargetChangedEvent;
    }
  | { type: "interact"; payload: InteractEvent }
  | { type: "add-to-inventory"; payload: AddToInventoryEvent }
  | { type: "inventory-updated"; payload: InventoryUpdatedEvent }
  | { type: "request-respawn"; payload: RequestRespawnEvent };

/**
 * A union of all possible event type strings.
 */
export type GameEventType = GameEvent["type"];

/**
 * A generic type for a function that listens for events.
 * @param event The event data payload.
 */
export type EventListener<T> = (event: T) => void;

/**
 * A simple, generic event manager (event bus).
 * @remarks
 * This class provides a centralized way for different parts of the engine
 * to subscribe to and publish events without being directly coupled to each
 * other.
 * It uses a double-buffered queue to allow events to be published during an
 * update loop without affecting the set of events being processed in that same
 * loop.
 */
export class EventManager {
  private listeners = new Map<GameEventType, Set<EventListener<GameEvent>>>();
  private eventQueue: GameEvent[] = [];
  private processingQueue: GameEvent[] = [];

  /**
   * Subscribes a listener function to a specific event type.
   * @param type The string identifier of the event type to listen for.
   * @param listener The function to be called when the event is published.
   */
  public subscribe(
    type: GameEventType,
    listener: EventListener<GameEvent>,
  ): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(listener);
  }

  /**
   * Unsubscribes a listener function from a specific event type.
   * @param type The string identifier of the event type.
   * @param listener The listener function to remove.
   */
  public unsubscribe(
    type: GameEventType,
    listener: EventListener<GameEvent>,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  /**
   * Adds an event to the queue to be processed on the next update.
   * @param event The event object to publish. It must have a 'type' property.
   */
  public publish(event: GameEvent): void {
    this.eventQueue.push(event);
  }

  /**
   * Dispatches all queued events to their subscribed listeners.
   * @remarks
   * This method should be called once per frame in the main game loop. It
   * swaps the event queues to ensure that events published during the dispatch
   * process are queued for the next frame, preventing infinite loops.
   */
  public update(): void {
    if (this.eventQueue.length === 0) {
      return;
    }

    // Swap queues
    [this.processingQueue, this.eventQueue] = [
      this.eventQueue,
      this.processingQueue,
    ];
    this.eventQueue.length = 0;

    for (const event of this.processingQueue) {
      const eventListeners = this.listeners.get(event.type);
      if (eventListeners) {
        for (const listener of eventListeners) {
          listener(event);
        }
      }
    }

    this.processingQueue.length = 0;
  }
}

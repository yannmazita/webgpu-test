// src/core/ecs/events.ts
import { Entity } from "@/core/ecs/entity";
import { Vec3 } from "wgpu-matrix";

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

/* ==========================================================================================
 * COLLISION EVENTS
 *
 * The physics worker currently emits collision records whose `physId`
 * values mirror ECS entity IDs. If that mapping ever diverges, publish
 * translated ECS entities instead of raw physics identifiers.
 * ======================================================================================== */

/**
 * Fired when two physics bodies start colliding.
 */
export interface CollisionStartedEvent {
  entityA: Entity;
  entityB: Entity;
  /** World position of the primary contact point. */
  contactPoint: Vec3;
  /** Collision normal pointing from A to B. */
  normal: Vec3;
  /** Magnitude of the collision impulse. */
  impulse: number;
  /** Penetration depth at contact. */
  penetration: number;
}

/**
 * Fired when two physics bodies stop colliding.
 */
export interface CollisionEndedEvent {
  entityA: Entity;
  entityB: Entity;
}

/**
 * Fired when a sensor (trigger volume) starts overlapping with another collider.
 */
export interface SensorEnteredEvent {
  /** The sensor entity (trigger volume). */
  sensor: Entity;
  /** The entity that entered the sensor. */
  other: Entity;
}

/**
 * Fired when a sensor stops overlapping with another collider.
 */
export interface SensorExitedEvent {
  /** The sensor entity (trigger volume). */
  sensor: Entity;
  /** The entity that exited the sensor. */
  other: Entity;
}

/* ==========================================================================================
 * CHARACTER CONTROLLER EVENTS
 *
 * Character-controller events rely on the same physId ⇔ entity mirroring.
 * Update the event systems if the physics worker stops emitting ECS IDs.
 * ======================================================================================== */

/**
 * Fired when the player's ground state changes.
 */
export interface GroundStateChangedEvent {
  entity: Entity;
  /** True if now grounded, false if now airborne. */
  isGrounded: boolean;
  /** Optional: the entity the character is standing on. */
  groundEntity?: Entity;
}

/**
 * Fired when the character controller detects a wall contact.
 */
export interface WallContactEvent {
  entity: Entity;
  /** Normal of the wall surface. */
  wallNormal: Vec3;
  /** The wall entity, if any. */
  wallEntity?: Entity;
}

/**
 * Fired when the character controller climbs a step.
 */
export interface StepClimbedEvent {
  entity: Entity;
  /** Height of the step climbed. */
  stepHeight: number;
}

/**
 * Fired when the character hits a ceiling.
 */
export interface CeilingHitEvent {
  entity: Entity;
  /** The ceiling entity, if any. */
  ceilingEntity?: Entity;
}

/**
 * Fired when the character starts or stops sliding.
 */
export interface SlidingStateChangedEvent {
  entity: Entity;
  /** True if now sliding, false if stopped sliding. */
  isSliding: boolean;
}

/* ==========================================================================================
 * DAMAGE EVENTS
 * ======================================================================================== */

/**
 * Fired when an entity takes damage (before health is reduced).
 */
export interface DamageTakenEvent {
  target: Entity;
  amount: number;
  source?: Entity;
  /** Optional: position where damage was applied. */
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

/* ==========================================================================================
 * PHYSICS STATE EVENTS
 * ======================================================================================== */

/**
 * Fired when a dynamic body goes to sleep (optimization event).
 */
export interface BodySleptEvent {
  entity: Entity;
}

/**
 * Fired when a sleeping body wakes up.
 */
export interface BodyWokeEvent {
  entity: Entity;
}

/**
 * Fired when a body's velocity crosses a threshold.
 * Useful for landing impact detection.
 */
export interface VelocityThresholdEvent {
  entity: Entity;
  velocity: Vec3;
  speed: number;
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
  | RequestRespawnEvent
  | CollisionStartedEvent
  | CollisionEndedEvent
  | SensorEnteredEvent
  | SensorExitedEvent
  | GroundStateChangedEvent
  | WallContactEvent
  | StepClimbedEvent
  | CeilingHitEvent
  | SlidingStateChangedEvent
  | DamageTakenEvent
  | DamageDealtEvent
  | BodySleptEvent
  | BodyWokeEvent
  | VelocityThresholdEvent;

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
  | { type: "request-respawn"; payload: RequestRespawnEvent }
  | { type: "collision-started"; payload: CollisionStartedEvent }
  | { type: "collision-ended"; payload: CollisionEndedEvent }
  | { type: "sensor-entered"; payload: SensorEnteredEvent }
  | { type: "sensor-exited"; payload: SensorExitedEvent }
  | { type: "ground-state-changed"; payload: GroundStateChangedEvent }
  | { type: "wall-contact"; payload: WallContactEvent }
  | { type: "step-climbed"; payload: StepClimbedEvent }
  | { type: "ceiling-hit"; payload: CeilingHitEvent }
  | { type: "sliding-state-changed"; payload: SlidingStateChangedEvent }
  | { type: "damage-taken"; payload: DamageTakenEvent }
  | { type: "damage-dealt"; payload: DamageDealtEvent }
  | { type: "body-slept"; payload: BodySleptEvent }
  | { type: "body-woke"; payload: BodyWokeEvent }
  | { type: "velocity-threshold"; payload: VelocityThresholdEvent };

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

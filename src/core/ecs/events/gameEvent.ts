import {
  DeathEvent,
  FireWeaponEvent,
  InteractionTargetChangedEvent,
  InteractEvent,
  AddToInventoryEvent,
  InventoryUpdatedEvent,
  RequestRespawnEvent,
} from "@/core/ecs/events/commonEvents";

import {
  CollisionStartedEvent,
  CollisionEndedEvent,
  SensorEnteredEvent,
  SensorExitedEvent,
} from "@/core/ecs/events/collisionEvents";

import {
  GroundStateChangedEvent,
  WallContactEvent,
  StepClimbedEvent,
  CeilingHitEvent,
  SlidingStateChangedEvent,
} from "@/core/ecs/events/characterEvents";

import {
  DamageTakenEvent,
  DamageDealtEvent,
} from "@/core/ecs/events/damageEvents";
import {
  BodySleptEvent,
  BodyWokeEvent,
  VelocityThresholdEvent,
} from "@/core/ecs/events/physicsEvents";
import {
  AimStateChangedEvent,
  AmmoChangedEvent,
  AmmoCollectedEvent,
  HitMarkerEvent,
  HitscanFiredEvent,
  HitscanHitEvent,
  ProjectileImpactEvent,
  ProjectileSpawnedEvent,
  WeaponEmptyEvent,
  WeaponEquippedEvent,
  WeaponHolsteredEvent,
  WeaponReloadCompletedEvent,
  WeaponReloadStartedEvent,
  WeaponSwitchCompletedEvent,
  WeaponSwitchStartedEvent,
} from "./combatEvents";

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
  | VelocityThresholdEvent
  | WeaponEquippedEvent
  | WeaponHolsteredEvent
  | WeaponSwitchStartedEvent
  | WeaponSwitchCompletedEvent
  | WeaponReloadStartedEvent
  | WeaponReloadCompletedEvent
  | WeaponEmptyEvent
  | ProjectileSpawnedEvent
  | ProjectileImpactEvent
  | HitscanFiredEvent
  | HitscanHitEvent
  | HitMarkerEvent
  | AmmoCollectedEvent
  | AmmoChangedEvent
  | AimStateChangedEvent;

/** Discriminated union of all possible game events. */
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
  | { type: "velocity-threshold"; payload: VelocityThresholdEvent }
  | { type: "weapon-equipped"; payload: WeaponEquippedEvent }
  | { type: "weapon-holstered"; payload: WeaponHolsteredEvent }
  | { type: "weapon-switch-started"; payload: WeaponSwitchStartedEvent }
  | { type: "weapon-switch-completed"; payload: WeaponSwitchCompletedEvent }
  | { type: "weapon-reload-started"; payload: WeaponReloadStartedEvent }
  | { type: "weapon-reload-completed"; payload: WeaponReloadCompletedEvent }
  | { type: "weapon-empty"; payload: WeaponEmptyEvent }
  | { type: "projectile-spawned"; payload: ProjectileSpawnedEvent }
  | { type: "projectile-impact"; payload: ProjectileImpactEvent }
  | { type: "hitscan-fired"; payload: HitscanFiredEvent }
  | { type: "hitscan-hit"; payload: HitscanHitEvent }
  | { type: "hit-marker"; payload: HitMarkerEvent }
  | { type: "ammo-collected"; payload: AmmoCollectedEvent }
  | { type: "ammo-changed"; payload: AmmoChangedEvent }
  | { type: "aim-state-changed"; payload: AimStateChangedEvent };

/**
 * A union of all possible event type strings.
 */
export type GameEventType = GameEvent["type"];

/**
 * A generic type for a function that listens for events.
 * @param event The event data payload.
 */
export type EventListener<T> = (event: T) => void;

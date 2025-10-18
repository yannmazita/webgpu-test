// src/core/ecs/events/combatEvents.ts
import { Entity } from "@/core/ecs/entity";
import { Vec3 } from "wgpu-matrix";

/**
 * Fired when a weapon is equipped/drawn.
 * Useful for: animation triggers, UI updates, sound effects.
 */
export interface WeaponEquippedEvent {
  entity: Entity;
  /** The entity ID of the weapon, if weapons are separate entities */
  weaponEntity?: Entity;
  /** Weapon identifier for systems that need to know which weapon */
  weaponType: string;
}

/**
 * Fired when a weapon is holstered/put away.
 */
export interface WeaponHolsteredEvent {
  entity: Entity;
  weaponType: string;
}

/**
 * Fired when weapon switching begins.
 * Useful for: preventing firing during switch, animation system.
 */
export interface WeaponSwitchStartedEvent {
  entity: Entity;
  fromWeapon: string;
  toWeapon: string;
}

/**
 * Fired when weapon switch animation completes and new weapon is ready.
 */
export interface WeaponSwitchCompletedEvent {
  entity: Entity;
  activeWeapon: string;
}

/**
 * Fired when reload begins.
 * Useful for: animation, sound, preventing firing during reload.
 */
export interface WeaponReloadStartedEvent {
  entity: Entity;
  weaponType: string;
  /** Current ammo in magazine before reload */
  currentAmmo: number;
  /** Ammo that will be loaded */
  reloadAmount: number;
}

/**
 * Fired when reload completes.
 */
export interface WeaponReloadCompletedEvent {
  entity: Entity;
  weaponType: string;
  /** New ammo count after reload */
  newAmmo: number;
}

/**
 * Fired when ammo is depleted (dry fire).
 * Useful for: UI feedback, playing click sound, triggering auto-reload.
 */
export interface WeaponEmptyEvent {
  entity: Entity;
  weaponType: string;
}

/**
 * Fired when a projectile is spawned.
 * Useful for: VFX systems, sound, tracking for stats.
 */
export interface ProjectileSpawnedEvent {
  projectile: Entity;
  owner: Entity;
  spawnPosition: Vec3;
  velocity: Vec3;
  weaponType: string;
}

/**
 * Fired when a projectile impacts something.
 * Separate from collision-started for gameplay clarity.
 */
export interface ProjectileImpactEvent {
  projectile: Entity;
  owner: Entity;
  target: Entity;
  position: Vec3;
  normal: Vec3;
  /** True if target was damageable and damage was applied */
  dealtDamage: boolean;
}

/**
 * Fired immediately after a hitscan weapon fires (before hit processing).
 * Useful for: muzzle flash VFX, recoil, tracer effects.
 */
export interface HitscanFiredEvent {
  shooter: Entity;
  weaponType: string;
  rayOrigin: Vec3;
  rayDirection: Vec3;
  range: number;
}

/**
 * Fired when a hitscan weapon successfully hits something.
 */
export interface HitscanHitEvent {
  shooter: Entity;
  target: Entity;
  weaponType: string;
  hitPosition: Vec3;
  hitNormal: Vec3;
  distance: number;
  /** True if target was damageable and damage was applied */
  dealtDamage: boolean;
}

/**
 * Visual/audio confirmation that damage was dealt.
 * Separate from DamageDealtEvent - this is for UI/feedback only.
 */
export interface HitMarkerEvent {
  attacker: Entity;
  victim: Entity;
  /** Whether this was a critical/headshot/special hit */
  isCritical: boolean;
}

/**
 * Ammo pickup or resupply.
 */
export interface AmmoCollectedEvent {
  entity: Entity;
  ammoType: string;
  amount: number;
  /** New total ammo count */
  newTotal: number;
}

/**
 * Fired when ammo count changes (shot fired, reloaded, picked up).
 * Useful for: UI updates.
 */
export interface AmmoChangedEvent {
  entity: Entity;
  weaponType: string;
  /** Ammo in current magazine */
  magazineAmmo: number;
  /** Reserve ammo */
  reserveAmmo: number;
}

/**
 * Weapon aim-down-sights state changed.
 */
export interface AimStateChangedEvent {
  entity: Entity;
  isAiming: boolean;
}

// src/core/ecs/components/weaponComponent.ts
import { IComponent } from "@/core/ecs/component";

/**
 * Component that holds the properties and state for a weapon.
 */
export class WeaponComponent implements IComponent {
  /** How many shots can be fired per second. */
  public fireRate = 10.0;

  /** The effective range of the weapon in world units. */
  public range = 100.0;

  /** The amount of damage inflicted by a single shot. */
  public damage = 10.0;

  /**
   * A timer to manage the cooldown between shots.
   * When a shot is fired, this is reset to (1 / fireRate).
   * It is decremented each frame, and a new shot can only be fired
   * when it is less than or equal to zero.
   * @internal
   */
  public cooldown = 0.0;
}
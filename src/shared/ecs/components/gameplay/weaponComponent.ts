// src/shared/ecs/components/gameplay/weaponComponent.ts
import { IComponent } from "@/shared/ecs/component";
import { ResourceHandle } from "@/shared/resources/resourceHandle";
import { MaterialInstance } from "@/client/rendering/materials/materialInstance";
import { Mesh } from "@/client/types/gpu";

/**
 * Component that holds the properties and state for a weapon.
 * Can be configured for either instant hitscan or projectile-based firing.
 */
export class WeaponComponent implements IComponent {
  public weaponType = "default"; // todo: type this

  /** How many shots can be fired per second. */
  public fireRate = 10.0;

  /** The amount of damage inflicted by a single shot. */
  public damage = 10.0;

  // --- Hitscan Properties ---
  /** If true, the weapon performs an instant raycast. If false, it spawns a projectile. */
  public isHitscan = true;
  /** The effective range of the weapon in world units (hitscan only). */
  public range = 100.0;

  // --- Projectile Properties ---
  /** The speed of the spawned projectile in world units per second. */
  public projectileSpeed = 50.0;
  /** The lifetime of the spawned projectile in seconds. */
  public projectileLifetime = 2.0;
  /** A handle to the mesh to use for rendering the projectile. */
  public projectileMeshHandle?: ResourceHandle<Mesh>;
  /** A handle to the material to use for rendering the projectile. */
  public projectileMaterialHandle?: ResourceHandle<MaterialInstance>;
  /** The radius of the projectile's physics collider. */
  public projectileRadius = 0.1;

  // -- Ammo properties
  public usesAmmo = true;
  public magazineSize = 30;
  public currentMagazineAmmo = 30;
  public reserveAmmo = 90;
  public maxReserveAmmo = 90;
  public reloadTime = 2.0; // seconds
  public isReloading = false;
  public reloadTimer = 0.0;

  /**
   * A timer to manage the cooldown between shots.
   * When a shot is fired, this is reset to (1 / fireRate).
   * It is decremented each frame, and a new shot can only be fired
   * when it is less than or equal to zero.
   * @internal
   */
  public cooldown = 0.0;
}

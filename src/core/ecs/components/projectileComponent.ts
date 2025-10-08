// src/core/ecs/components/projectileComponent.ts

import { IComponent } from "@/core/ecs/component";
import { Entity } from "../entity";

/**
 * Marks an entity as a projectile and stores its gameplay properties.
 *
 * This component is typically paired with a TransformComponent and a
 * PhysicsBodyComponent. The physics body handles the actual movement and
 * collision detection, while this component defines the projectile's behavior
 * upon impact and its lifespan.
 */
export class ProjectileComponent implements IComponent {
  /** The entity that fired this projectile. Used to prevent self-damage. */
  public owner: Entity;

  /** The amount of damage to inflict upon collision with a damageable entity. */
  public damage: number;

  /**
   * The remaining time, in seconds, before this projectile is automatically
   * destroyed. This is decremented by the projectileSystem each frame.
   */
  public lifetime: number;

  /**
   * Constructs a new ProjectileComponent.
   * @param owner The entity that fired the projectile.
   * @param damage The damage it will deal.
   * @param lifetime The lifespan of the projectile in seconds.
   */
  constructor(owner: Entity, damage: number, lifetime: number) {
    this.owner = owner;
    this.damage = damage;
    this.lifetime = lifetime;
  }
}

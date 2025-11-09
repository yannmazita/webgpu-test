// src/shared/ecs/components/gameplay/projectileComponent.ts
import { IComponent } from "@/shared/ecs/component";
import { Entity } from "@/shared/ecs/entity";

/**
 * Marks an entity as a projectile and stores its gameplay properties.
 *
 * This component is typically paired with a TransformComponent and a
 * PhysicsBodyComponent. The physics body handles the actual movement and
 * collision detection, while this component defines the projectile's behavior
 * upon impact. Its lifespan is managed by a separate `LifetimeComponent`.
 */
export class ProjectileComponent implements IComponent {
  /** The entity that fired this projectile. Used to prevent self-damage. */
  public owner: Entity;

  /** The amount of damage to inflict upon collision with a damageable entity. */
  public damage: number;

  /**
   * Constructs a new ProjectileComponent.
   * @param owner The entity that fired the projectile.
   * @param damage The damage it will deal.
   */
  constructor(owner: Entity, damage: number) {
    this.owner = owner;
    this.damage = damage;
  }
}

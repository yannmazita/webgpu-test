// src/core/ecs/systems/projectileSystem.ts

import { World } from "@/core/ecs/world";
import { ProjectileComponent } from "@/core/ecs/components/projectileComponent";

/**
 * Manages the lifecycle of projectiles, primarily their lifetime.
 *
 * Projectiles are destroyed when their lifetime expires. Collision handling is
 * delegated to the CollisionEventSystem, which may destroy projectiles upon
 * impact before their lifetime runs out.
 */
export class ProjectileSystem {
  /**
   * Updates all projectile entities.
   *
   * Decrements their lifetime and destroys them if it reaches zero.
   * @param world The ECS world.
   * @param deltaTime The time elapsed since the last frame, in seconds.
   */
  public update(world: World, deltaTime: number): void {
    const projectiles = world.query([ProjectileComponent]);
    if (projectiles.length === 0) {
      return;
    }

    const entitiesToDestroy: number[] = [];

    for (const entity of projectiles) {
      const projectile = world.getComponent(entity, ProjectileComponent);
      if (!projectile) continue;

      projectile.lifetime -= deltaTime;
      if (projectile.lifetime <= 0) {
        entitiesToDestroy.push(entity);
      }
    }

    // Destroy entities outside the loop to avoid modifying the query results
    // while iterating.
    for (const entity of entitiesToDestroy) {
      world.destroyEntity(entity);
    }
  }
}

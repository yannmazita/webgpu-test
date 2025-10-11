// src/core/ecs/systems/lifetimeSystem.ts
import { World } from "@/core/ecs/world";
import { LifetimeComponent } from "@/core/ecs/components/lifetimeComponent";

/**
 * Manages the lifecycle of entities with a `LifetimeComponent`.
 *
 * Each frame, this system decrements the `remainingTime` for all entities
 * with a lifetime. If the time expires (<= 0), the entity is destroyed.
 * This is useful for projectiles, particles, temporary visual effects, etc.
 *
 * @param world The ECS world.
 * @param deltaTime The time elapsed since the last frame, in seconds.
 */
export function lifetimeSystem(world: World, deltaTime: number): void {
  const query = world.query([LifetimeComponent]);
  if (query.length === 0) {
    return;
  }

  const entitiesToDestroy: number[] = [];

  for (const entity of query) {
    const lifetime = world.getComponent(entity, LifetimeComponent);
    if (!lifetime) continue;

    lifetime.remainingTime -= deltaTime;
    if (lifetime.remainingTime <= 0) {
      entitiesToDestroy.push(entity);
    }
  }

  // Destroy entities outside the loop to avoid modifying the query results
  // while iterating.
  for (const entity of entitiesToDestroy) {
    world.destroyEntity(entity);
  }
}

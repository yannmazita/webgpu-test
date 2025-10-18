// src/core/ecs/systems/particleSystem.ts
import { World } from "@/core/ecs/world";
import { ParticleEmitterComponent } from "@/core/ecs/components/particleComponents";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { ParticleSubsystem } from "@/core/rendering/particle";

/**
 * A system that manages the game logic for particle emitters.
 * @remarks
 * This system is responsible for iterating over all entities with a
 * `ParticleEmitterComponent` and telling the `ParticleSubsystem` to spawn
 * new particles based on the emitter's properties and the frame's `deltaTime`.
 * It does not interact directly with any GPU resources.
 */
export class ParticleSystem {
  /**
   * Updates all particle emitters in the world.
   * @param world The ECS world.
   * @param deltaTime The time elapsed since the last frame.
   * @param particleSubsystem The rendering subsystem that handles GPU resources.
   */
  public update(
    world: World,
    deltaTime: number,
    particleSubsystem: ParticleSubsystem,
  ): void {
    const emitters = world.query([
      ParticleEmitterComponent,
      TransformComponent,
    ]);

    for (const entity of emitters) {
      const emitter = world.getComponent(entity, ParticleEmitterComponent);
      const transform = world.getComponent(entity, TransformComponent);
      if (!emitter || !transform || !emitter.isEnabled) continue;

      if (emitter.lifetime > 0) {
        emitter.age += deltaTime;
        if (emitter.age >= emitter.lifetime) {
          emitter.isEnabled = false;
          continue;
        }
      }

      emitter.accumulator += emitter.emitRate * deltaTime;
      const numToSpawn = Math.floor(emitter.accumulator);
      if (numToSpawn > 0) {
        particleSubsystem.spawn(numToSpawn, emitter, transform.position);
        emitter.accumulator -= numToSpawn;
      }
    }
  }
}

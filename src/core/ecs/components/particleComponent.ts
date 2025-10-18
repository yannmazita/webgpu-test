// src/core/ecs/components/particleComponents.ts
import { IComponent } from "@/core/ecs/component";
import { Vec3, vec3, Vec4, vec4 } from "wgpu-matrix";

/**
 * A component that defines an entity as a source of particles.
 * @remarks
 * The ParticleSystem queries for these components and uses their properties to
 * spawn new particles on the GPU. This component controls the rate, lifetime,
 * and visual properties of the particles it emits.
 */
export class ParticleEmitterComponent implements IComponent {
  /**
   * The number of particles to emit per second.
   */
  public emitRate = 100;

  /**
   * The duration in seconds that the emitter should be active.
   * A value of 0 or less means it emits indefinitely.
   */
  public lifetime = 0.0;

  /**
   * The base velocity applied to every particle upon emission.
   */
  public initialVelocity: Vec3 = vec3.create(0, 5, 0);

  /**
   * A random velocity offset applied to each particle, defined as a half-extent.
   * For example, a spread of [1, 1, 1] will result in a random velocity offset
   * between [-1, -1, -1] and [1, 1, 1].
   */
  public spread: Vec3 = vec3.create(1, 1, 1);

  /**
   * The lifetime range for each particle in seconds. A random value between
   * min and max is chosen for each new particle.
   */
  public particleLifetime = { min: 0.5, max: 2.0 };

  /**
   * The size of the particle at the beginning of its life.
   */
  public startSize = 0.1;

  /**
   * The size of the particle at the end of its life.
   */
  public endSize = 0.01;

  /**
   * The color of the particle at the beginning of its life.
   */
  public startColor: Vec4 = vec4.fromValues(1.0, 0.8, 0.5, 1.0);

  /**
   * The color of the particle at the end of its life.
   */
  public endColor: Vec4 = vec4.fromValues(1.0, 0.2, 0.0, 0.0);

  // --- Internal State ---
  /**
   * An accumulator to track fractional particles to be emitted between frames.
   * @internal
   */
  public accumulator = 0.0;

  /**
   * The total time the emitter has been active.
   * @internal
   */
  public age = 0.0;

  /**
   * A flag indicating if the emitter is currently active.
   */
  public isEnabled = true;
}

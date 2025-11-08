// src/shared/ecs/components/lifetimeComponent.ts
import { IComponent } from "@/shared/ecs/component";

/**
 * A component that gives an entity a limited lifespan.
 * The `lifetimeSystem` will destroy the entity when `remainingTime` reaches zero.
 */
export class LifetimeComponent implements IComponent {
  /**
   * The remaining time, in seconds, before this entity is destroyed.
   */
  public remainingTime: number;

  constructor(lifetime = 1.0) {
    this.remainingTime = lifetime;
  }
}

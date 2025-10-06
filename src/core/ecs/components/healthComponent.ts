// src/core/ecs/components/healthComponent.ts
import { IComponent } from "@/core/ecs/component";

/**
 * Component that holds health points for an entity.
 */
export class HealthComponent implements IComponent {
  public maxHealth: number;
  public currentHealth: number;

  constructor(health = 100) {
    this.maxHealth = health;
    this.currentHealth = health;
  }
}

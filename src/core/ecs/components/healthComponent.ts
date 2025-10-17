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

  /**
   * Reduces the entity's current health by a specified amount.
   * Health is clamped to a minimum of 0.
   * @param amount The amount of damage to take.
   */
  public takeDamage(amount: number): void {
    this.currentHealth = Math.max(0, this.currentHealth - amount);
  }

  /**
   * Increases the entity's current health by a specified amount.
   * Health is clamped to a maximum of `HealthComponent.maxHealth`.
   * @param amount The amount of healing to give.
   */
  public heal(amount: number): void {
    this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount);
  }

  /**
   * Checks if the entity's health has reached zero.
   * @returns True if currentHealth is 0 or less, false otherwise.
   */
  public isDead(): boolean {
    return this.currentHealth <= 0;
  }
}

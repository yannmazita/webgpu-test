// src/core/ecs/components/pickupComponent.ts
import { IComponent } from "@/core/ecs/component";

/**
 * Defines an entity as an item that can be picked up and added to an inventory.
 *
 * @remarks
 * This component should be paired with an `InteractableComponent` to allow
 * the player to trigger the pickup action. The `PickupSystem` processes this component.
 */
export class PickupComponent implements IComponent {
  /** A unique string identifier for the item type (like "health_pack", "ammo_pistol"). */
  public itemId: string;

  /** The number of items to grant upon pickup. */
  public quantity: number;

  /** If true, the entity will be destroyed after it is successfully picked up. */
  public destroyOnPickup: boolean;

  /**
   * @param itemId The unique ID for the item type.
   * @param quantity The amount of the item.
   * @param destroyOnPickup Whether to destroy the entity on pickup.
   */
  constructor(itemId: string, quantity = 1, destroyOnPickup = true) {
    this.itemId = itemId;
    this.quantity = quantity;
    this.destroyOnPickup = destroyOnPickup;
  }
}

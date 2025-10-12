// src/core/ecs/components/inventoryComponent.ts
import { IComponent } from "@/core/ecs/component";

/**
 * Stores a collection of items for an entity.
 *
 * @remarks
 * This component acts as a container for items identified by a unique string ID.
 * It is managed by the `InventorySystem`.
 */
export class InventoryComponent implements IComponent {
  /** A map where keys are item IDs and values are the quantity of that item. */
  public items = new Map<string, number>();

  /** The maximum number of unique item stacks this inventory can hold. */
  public capacity: number;

  /**
   * @param capacity The maximum number of unique item stacks.
   */
  constructor(capacity = 10) {
    this.capacity = capacity;
  }
}

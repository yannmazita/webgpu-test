// src/shared/ecs/systems/inventorySystem.ts
import { World } from "@/shared/ecs/world";
import { EventManager } from "@/shared/ecs/events/eventManager";
import { GameEvent } from "@/shared/ecs/events/gameEvent";
import { InventoryComponent } from "@/shared/ecs/components/inventoryComponent";

/**
 * Manages the state of all inventories in the world.
 *
 * This system listens for `AddToInventoryEvent`s and modifies the appropriate
 * `InventoryComponent`. After a modification, it publishes an `InventoryUpdatedEvent`
 * so that other systems (like the UI) can react to the change.
 */
export class InventorySystem {
  constructor(
    private world: World,
    private eventManager: EventManager,
  ) {
    this.eventManager.subscribe(
      "add-to-inventory",
      this.onAddToInventory.bind(this),
    );
  }

  private onAddToInventory(event: GameEvent): void {
    if (event.type !== "add-to-inventory") return;

    const { entity, itemId, quantity } = event.payload;
    const inventory = this.world.getComponent(entity, InventoryComponent);

    if (!inventory) {
      console.warn(
        `[InventorySystem] Entity ${entity} tried to receive item "${itemId}" but has no InventoryComponent.`,
      );
      return;
    }

    const currentQuantity = inventory.items.get(itemId) ?? 0;
    const newQuantity = currentQuantity + quantity;

    if (
      !inventory.items.has(itemId) &&
      inventory.items.size >= inventory.capacity
    ) {
      console.log(
        `[InventorySystem] Inventory full for entity ${entity}. Cannot add item "${itemId}".`,
      );
      // maybe publish an "InventoryFull" event here
      return;
    }

    inventory.items.set(itemId, newQuantity);
    console.log(
      `[InventorySystem] Entity ${entity}'s inventory updated: ${itemId} is now ${newQuantity}.`,
    );

    this.eventManager.publish({
      type: "inventory-updated",
      payload: { owner: entity },
    });
  }

  public update(): void {
    // This system is purely event-driven.
  }
}

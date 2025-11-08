// src/shared/ecs/systems/pickupSystem.ts
import { World } from "@/shared/ecs/world";
import { EventManager } from "@/shared/ecs/events/eventManager";
import { GameEvent } from "@/shared/ecs/events/gameEvent";
import { PickupComponent } from "@/shared/ecs/components/pickupComponent";
import { InteractableComponent } from "@/shared/ecs/components/interactableComponent";

/**
 * Handles the logic for picking up items.
 *
 * This system listens for `InteractEvent`s. When an interaction occurs with an
 * entity that has a `PickupComponent`, it fires an `AddToInventoryEvent` and,
 * if configured, destroys the pickup entity.
 */
export class PickupSystem {
  constructor(
    private world: World,
    private eventManager: EventManager,
  ) {
    this.eventManager.subscribe("interact", this.onInteract.bind(this));
  }

  private onInteract(event: GameEvent): void {
    if (event.type !== "interact") return;
    console.log("[PickupSystem] Received 'interact' event.", event.payload);

    const { interactor, target } = event.payload;

    const isInteractable = this.world.hasComponent(
      target,
      InteractableComponent,
    );
    const pickup = this.world.getComponent(target, PickupComponent);

    console.log(
      `[PickupSystem] Target ${target} has InteractableComponent: ${isInteractable}`,
    );
    console.log(
      `[PickupSystem] Target ${target} has PickupComponent: ${!!pickup}`,
    );

    if (isInteractable && pickup) {
      console.log(
        `[PickupSystem] Entity ${interactor} picked up ${pickup.quantity} of ${pickup.itemId} from entity ${target}.`,
      );

      // Request to add the item to the interactor's inventory
      this.eventManager.publish({
        type: "add-to-inventory",
        payload: {
          entity: interactor,
          itemId: pickup.itemId,
          quantity: pickup.quantity,
        },
      });

      if (pickup.destroyOnPickup) {
        console.log(`[PickupSystem] Destroying entity ${target}.`);
        this.world.destroyEntity(target);
      }
    }
  }

  public update(): void {
    // This system is purely event-driven.
  }
}

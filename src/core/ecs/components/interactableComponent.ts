// src/core/ecs/components/interactableComponent.ts
import { IComponent } from "@/core/ecs/component";

/**
 * Marks an entity as something the player can interact with.
 *
 * @remarks
 * The `InteractionSystem` uses this component to identify potential targets
 * for the player's "interact" action.
 */
export class InteractableComponent implements IComponent {
  /** The message displayed to the player when they can interact (like "Press [E] to open"). */
  public promptMessage: string;

  /** The maximum distance from which this object can be interacted with. */
  public interactionDistance: number;

  /**
   * @param promptMessage The message to display to the player.
   * @param interactionDistance The maximum interaction distance.
   */
  constructor(promptMessage = "Interact", interactionDistance = 3.0) {
    this.promptMessage = promptMessage;
    this.interactionDistance = interactionDistance;
  }
}

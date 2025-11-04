// src/core/ecs/systems/ui/uiInteractionSystem.ts
import { World } from "@/core/ecs/world";
import { EventManager } from "@/core/ecs/events/eventManager";
import { UITransformComponent } from "@/core/ecs/components/ui/uiTransformComponent";
import {
  UIInteractiveComponent,
  UIDraggableComponent,
} from "@/core/ecs/components/ui/uiInteractionComponent";
import { Entity } from "@/core/ecs/entity";

/**
 * Handles mouse/touch interactions with UI elements and publishes events.
 * This system is the bridge between raw input and the UI event system.
 */
export class UIInteractionSystem {
  private mouseX = 0;
  private mouseY = 0;
  private mouseButtons = new Map<number, boolean>();
  private previousMouseButtons = new Map<number, boolean>();
  private eventManager: EventManager;

  // Track which entity is currently being interacted with
  private hoveredEntity?: Entity;
  private pressedEntity?: Entity;
  private draggedEntity?: Entity;
  private focusedEntity?: Entity;

  constructor(eventManager: EventManager) {
    this.eventManager = eventManager;
  }

  /**
   * Updates mouse position from input events
   */
  public updateMousePosition(x: number, y: number): void {
    this.mouseX = x;
    this.mouseY = y;
  }

  /**
   * Updates mouse button state from input events
   */
  public updateMouseButton(button: number, down: boolean): void {
    this.previousMouseButtons.set(
      button,
      this.mouseButtons.get(button) ?? false,
    );
    this.mouseButtons.set(button, down);
  }

  /**
   * Main update loop - processes all interactive UI elements
   */
  public update(world: World): void {
    const interactiveEntities = world.query([
      UITransformComponent,
      UIInteractiveComponent,
    ]);

    // Sort by z-index (highest first for proper hit testing)
    const sorted = interactiveEntities.sort((a, b) => {
      const ta = world.getComponent(a, UITransformComponent);
      const tb = world.getComponent(b, UITransformComponent);
      if (ta && tb) {
        return tb.zIndex - ta.zIndex;
      } else {
        return 0;
      }
    });

    let topHitEntity: Entity | undefined;
    const leftButton = 0;

    // Find topmost hovered entity
    for (const entity of sorted) {
      const transform = world.getComponent(entity, UITransformComponent);
      const interactive = world.getComponent(entity, UIInteractiveComponent);

      if (interactive && !interactive.enabled) continue;

      if (transform) {
        const rect = transform.screenRect;
        const hit =
          this.mouseX >= rect.x &&
          this.mouseX <= rect.x + rect.w &&
          this.mouseY >= rect.y &&
          this.mouseY <= rect.y + rect.h;

        if (hit && topHitEntity === undefined) {
          topHitEntity = entity;
          break;
        }
      }
    }

    // Process hover state
    this.processHover(world, topHitEntity);

    // Process mouse button interactions
    const leftPressed = this.mouseButtons.get(leftButton) ?? false;
    const leftWasPressed = this.previousMouseButtons.get(leftButton) ?? false;
    const leftJustPressed = leftPressed && !leftWasPressed;
    const leftJustReleased = !leftPressed && leftWasPressed;

    // Press detection
    if (leftJustPressed && topHitEntity !== undefined) {
      this.processPress(world, topHitEntity, leftButton);
    }

    // Release and click detection
    if (leftJustReleased && this.pressedEntity !== undefined) {
      this.processRelease(world, this.pressedEntity, topHitEntity, leftButton);
    }

    // Drag handling
    if (leftPressed && this.draggedEntity !== undefined) {
      this.processDrag(world, this.draggedEntity);
    } else if (leftJustReleased && this.draggedEntity !== undefined) {
      this.processDragEnd(world, this.draggedEntity);
    }

    // Update previous state
    for (const [button, pressed] of this.mouseButtons) {
      this.previousMouseButtons.set(button, pressed);
    }
  }

  private processHover(world: World, hitEntity?: Entity): void {
    // Unhover previous entity if different
    if (this.hoveredEntity !== undefined && this.hoveredEntity !== hitEntity) {
      const interactive = world.getComponent(
        this.hoveredEntity,
        UIInteractiveComponent,
      );
      if (interactive) {
        interactive.hovered = false;
        if (interactive.emitHoverEvents) {
          this.eventManager.publish({
            type: "ui:unhover",
            payload: {
              entity: this.hoveredEntity,
              mouseX: this.mouseX,
              mouseY: this.mouseY,
            },
          });
        }
      }
    }

    // Hover new entity
    if (hitEntity !== undefined) {
      const interactive = world.getComponent(hitEntity, UIInteractiveComponent);
      if (interactive && !interactive.hovered) {
        interactive.hovered = true;
        if (interactive.emitHoverEvents) {
          this.eventManager.publish({
            type: "ui:hover",
            payload: {
              entity: hitEntity,
              mouseX: this.mouseX,
              mouseY: this.mouseY,
            },
          });
        }
      }
    }

    this.hoveredEntity = hitEntity;
  }

  private processPress(world: World, entity: Entity, button: number): void {
    const interactive = world.getComponent(entity, UIInteractiveComponent);
    if (!interactive) return;

    interactive.pressed = true;
    interactive.pressedInside = true;
    this.pressedEntity = entity;

    this.eventManager.publish({
      type: "ui:press",
      payload: {
        entity,
        mouseX: this.mouseX,
        mouseY: this.mouseY,
        button,
      },
    });

    // Check if this element is draggable
    const draggable = world.getComponent(entity, UIDraggableComponent);
    if (draggable && interactive.emitDragEvents) {
      const transform = world.getComponent(entity, UITransformComponent);
      if (transform) {
        draggable.dragStartX = this.mouseX;
        draggable.dragStartY = this.mouseY;
        draggable.dragOffsetX = this.mouseX - transform.screenRect.x;
        draggable.dragOffsetY = this.mouseY - transform.screenRect.y;
      }
    }

    // Handle focus
    if (this.focusedEntity !== entity) {
      if (this.focusedEntity !== undefined) {
        const prevInteractive = world.getComponent(
          this.focusedEntity,
          UIInteractiveComponent,
        );
        if (prevInteractive) {
          prevInteractive.focused = false;
          this.eventManager.publish({
            type: "ui:blur",
            payload: {
              entity: this.focusedEntity,
            },
          });
        }
      }
      interactive.focused = true;
      this.focusedEntity = entity;
      this.eventManager.publish({
        type: "ui:focus",
        payload: {
          entity,
        },
      });
    }
  }

  private processRelease(
    world: World,
    pressedEntity: Entity,
    hitEntity: Entity | undefined,
    button: number,
  ): void {
    const interactive = world.getComponent(
      pressedEntity,
      UIInteractiveComponent,
    );
    if (!interactive) return;

    interactive.pressed = false;

    this.eventManager.publish({
      type: "ui:release",
      payload: {
        entity: pressedEntity,
        mouseX: this.mouseX,
        mouseY: this.mouseY,
        button,
      },
    });

    // Only emit click if released over the same element
    if (
      hitEntity === pressedEntity &&
      interactive.pressedInside &&
      interactive.emitClickEvents
    ) {
      this.eventManager.publish({
        type: "ui:click",
        payload: {
          entity: pressedEntity,
          mouseX: this.mouseX,
          mouseY: this.mouseY,
          button,
        },
      });
    }

    interactive.pressedInside = false;
    this.pressedEntity = undefined;
  }

  private processDrag(world: World, entity: Entity): void {
    const draggable = world.getComponent(entity, UIDraggableComponent);
    const transform = world.getComponent(entity, UITransformComponent);
    if (!draggable || !transform) return;

    const deltaX = this.mouseX - draggable.dragStartX;
    const deltaY = this.mouseY - draggable.dragStartY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Start dragging after threshold
    if (!draggable.isDragging && distance > draggable.dragThreshold) {
      draggable.isDragging = true;
      this.draggedEntity = entity;
      this.eventManager.publish({
        type: "ui:drag-start",
        payload: {
          entity,
          startX: draggable.dragStartX,
          startY: draggable.dragStartY,
        },
      });
    }

    if (draggable.isDragging) {
      // Update position
      const newX = this.mouseX - draggable.dragOffsetX;
      const newY = this.mouseY - draggable.dragOffsetY;

      // Apply constraints if needed
      let finalX = newX;
      let finalY = newY;

      if (draggable.constrainToParent && transform.parent !== undefined) {
        const parentTransform = world.getComponent(
          transform.parent,
          UITransformComponent,
        );
        if (parentTransform) {
          const parentRect = parentTransform.screenRect;
          finalX = Math.max(
            parentRect.x,
            Math.min(
              newX,
              parentRect.x + parentRect.w - transform.screenRect.w,
            ),
          );
          finalY = Math.max(
            parentRect.y,
            Math.min(
              newY,
              parentRect.y + parentRect.h - transform.screenRect.h,
            ),
          );
        }
      }

      transform.position[0] = finalX;
      transform.position[1] = finalY;

      this.eventManager.publish({
        type: "ui:drag-move",
        payload: {
          entity,
          currentX: this.mouseX,
          currentY: this.mouseY,
          deltaX: this.mouseX - draggable.dragStartX,
          deltaY: this.mouseY - draggable.dragStartY,
        },
      });
    }
  }

  private processDragEnd(world: World, entity: Entity): void {
    const draggable = world.getComponent(entity, UIDraggableComponent);
    if (!draggable) return;

    if (draggable.isDragging) {
      draggable.isDragging = false;
      this.eventManager.publish({
        type: "ui:drag-end",
        payload: {
          entity,
          endX: this.mouseX,
          endY: this.mouseY,
        },
      });
    }

    this.draggedEntity = undefined;
  }

  /**
   * Clears all interaction state (useful for scene transitions)
   */
  public reset(): void {
    this.hoveredEntity = undefined;
    this.pressedEntity = undefined;
    this.draggedEntity = undefined;
    this.focusedEntity = undefined;
    this.mouseButtons.clear();
    this.previousMouseButtons.clear();
  }
}

// src/shared/ecs/events/uiEvents.ts
import { Entity } from "@/shared/ecs/entity";

export interface UIClickEvent {
  entity: Entity;
  mouseX: number;
  mouseY: number;
  button: number; // 0 = left, 1 = middle, 2 = right
}

export interface UIHoverEvent {
  entity: Entity;
  mouseX: number;
  mouseY: number;
}

export interface UIUnhoverEvent {
  entity: Entity;
  mouseX: number;
  mouseY: number;
}

export interface UIPressEvent {
  entity: Entity;
  mouseX: number;
  mouseY: number;
  button: number;
}

export interface UIReleaseEvent {
  entity: Entity;
  mouseX: number;
  mouseY: number;
  button: number;
}

export interface UIDragStartEvent {
  entity: Entity;
  startX: number;
  startY: number;
}

export interface UIDragMoveEvent {
  entity: Entity;
  currentX: number;
  currentY: number;
  deltaX: number;
  deltaY: number;
}

export interface UIDragEndEvent {
  entity: Entity;
  endX: number;
  endY: number;
}

export interface UIValueChangeEvent {
  entity: Entity;
  oldValue: unknown;
  newValue: unknown;
}

export interface UITextInputEvent {
  entity: Entity;
  text: string;
}

export interface UIFocusEvent {
  entity: Entity;
}

export interface UIBlurEvent {
  entity: Entity;
}

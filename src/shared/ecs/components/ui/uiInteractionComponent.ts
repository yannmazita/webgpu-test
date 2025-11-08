// src/shared/ecs/components/ui/uiInteractionComponent.ts
import { IComponent } from "@/shared/ecs/component";

/**
 * Makes a UI element interactive and responsive to mouse/touch events.
 */
export class UIInteractiveComponent implements IComponent {
  public enabled = true;
  public hovered = false;
  public pressed = false;
  public focused = false;

  // Control which events this element should emit
  public emitClickEvents = true;
  public emitHoverEvents = true;
  public emitDragEvents = false;

  // For click detection
  public pressedInside = false;
}

/**
 * Button-specific styling that responds to interaction state
 */
export class UIButtonComponent implements IComponent {
  public normalColor: [number, number, number, number] = [0.2, 0.2, 0.2, 1];
  public hoverColor: [number, number, number, number] = [0.3, 0.3, 0.3, 1];
  public pressedColor: [number, number, number, number] = [0.15, 0.15, 0.15, 1];
  public disabledColor: [number, number, number, number] = [0.1, 0.1, 0.1, 0.5];
}

/**
 * Makes a UI element draggable
 */
export class UIDraggableComponent implements IComponent {
  public isDragging = false;
  public dragStartX = 0;
  public dragStartY = 0;
  public dragOffsetX = 0;
  public dragOffsetY = 0;
  public constrainToParent = true;
  public dragThreshold = 3; // pixels before drag starts
}

/**
 * Slider/progress bar value component
 */
export class UISliderComponent implements IComponent {
  public value = 0.5; // 0.0 to 1.0
  public min = 0;
  public max = 1;
  public step = 0.01;
  public orientation: "horizontal" | "vertical" = "horizontal";
}

/**
 * Text input field component
 */
export class UITextInputComponent implements IComponent {
  public value = "";
  public placeholder = "";
  public maxLength = 256;
  public cursorPosition = 0;
  public selectionStart = 0;
  public selectionEnd = 0;
  public isPassword = false;
}

// src/shared/ecs/systems/ui/uiButtonStyleSystem.ts
import { World } from "@/shared/ecs/world";
import { UIRectComponent } from "@/shared/ecs/components/ui/uiRenderComponent";
import {
  UIInteractiveComponent,
  UIButtonComponent,
} from "@/shared/ecs/components/ui/uiInteractionComponent";

/**
 * Updates button visual states based on interaction state
 */
export function uiButtonStyleSystem(world: World): void {
  const buttons = world.query([
    UIRectComponent,
    UIInteractiveComponent,
    UIButtonComponent,
  ]);

  for (const entity of buttons) {
    const rect = world.getComponent(entity, UIRectComponent);
    const interactive = world.getComponent(entity, UIInteractiveComponent);
    const button = world.getComponent(entity, UIButtonComponent);

    // Choose color based on state
    let targetColor: [number, number, number, number];

    if (interactive && button && rect) {
      if (interactive && !interactive.enabled) {
        targetColor = button.disabledColor;
      } else if (interactive.pressed) {
        targetColor = button.pressedColor;
      } else if (interactive.hovered) {
        targetColor = button.hoverColor;
      } else {
        targetColor = button.normalColor;
      }

      // Apply color
      rect.color[0] = targetColor[0];
      rect.color[1] = targetColor[1];
      rect.color[2] = targetColor[2];
      rect.color[3] = targetColor[3];
    }
  }
}

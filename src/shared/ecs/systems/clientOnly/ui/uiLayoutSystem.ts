// src/shared/ecs/systems/clientOnly/ui/uiLayoutSystem.ts
import { World } from "@/shared/ecs/world";
import {
  UITransformComponent,
  UIAnchor,
  UIUnits,
} from "@/shared/ecs/components/clientOnly/ui/uiTransformComponent";
import { Vec2 } from "wgpu-matrix";

/**
 * Computes screen-space rectangles for all UI elements based on their
 * transforms, anchors, and parent relationships.
 */
export function uiLayoutSystem(
  world: World,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const uiEntities = world.query([UITransformComponent]);

  // Sort by parent hierarchy (roots first)
  const sorted = topologicalSort(world, uiEntities);

  for (const entity of sorted) {
    const transform = world.getComponent(entity, UITransformComponent);

    // Calculate parent rect (or use screen as parent)
    let parentRect = { x: 0, y: 0, w: canvasWidth, h: canvasHeight };
    if (transform) {
      if (transform?.parent !== undefined) {
        const parentTransform = world.getComponent(
          transform.parent,
          UITransformComponent,
        );
        if (parentTransform) {
          parentRect = parentTransform.screenRect;
        }
      }

      // Calculate position
      const pos = resolvePosition(
        transform.position,
        transform.positionUnits,
        transform.anchor,
        parentRect,
        canvasWidth,
        canvasHeight,
      );

      // Calculate size
      const size = resolveSize(
        transform.size,
        transform.sizeUnits,
        parentRect,
        canvasWidth,
        canvasHeight,
      );

      // Update cached rect
      transform.screenRect = {
        x: pos[0],
        y: pos[1],
        w: size[0],
        h: size[1],
      };
    }
  }
}

function topologicalSort(world: World, entities: number[]): number[] {
  // Simple implementation: roots first, then children
  const roots: number[] = [];
  const children: number[] = [];

  for (const entity of entities) {
    const transform = world.getComponent(entity, UITransformComponent);
    if (transform) {
      if (transform.parent === undefined) {
        roots.push(entity);
      } else {
        children.push(entity);
      }
    }
  }

  return [...roots, ...children];
}

function resolvePosition(
  position: Vec2,
  units: UIUnits,
  anchor: UIAnchor,
  parentRect: { x: number; y: number; w: number; h: number },
  canvasW: number,
  canvasH: number,
): [number, number] {
  // Convert position to pixels
  let px = position[0];
  let py = position[1];

  switch (units) {
    case UIUnits.Percentage:
      px = (px / 100) * parentRect.w;
      py = (py / 100) * parentRect.h;
      break;
    case UIUnits.ViewportWidth:
      px = (px / 100) * canvasW;
      py = (py / 100) * canvasW; // Both use width
      break;
    case UIUnits.ViewportHeight:
      px = (px / 100) * canvasH;
      py = (py / 100) * canvasH;
      break;
  }

  // Apply anchor offset
  const anchorOffset = getAnchorOffset(anchor, parentRect);

  return [
    parentRect.x + anchorOffset[0] + px,
    parentRect.y + anchorOffset[1] + py,
  ];
}

function getAnchorOffset(
  anchor: UIAnchor,
  rect: { x: number; y: number; w: number; h: number },
): [number, number] {
  switch (anchor) {
    case UIAnchor.TopLeft:
      return [0, 0];
    case UIAnchor.TopCenter:
      return [rect.w / 2, 0];
    case UIAnchor.TopRight:
      return [rect.w, 0];
    case UIAnchor.MiddleLeft:
      return [0, rect.h / 2];
    case UIAnchor.MiddleCenter:
      return [rect.w / 2, rect.h / 2];
    case UIAnchor.MiddleRight:
      return [rect.w, rect.h / 2];
    case UIAnchor.BottomLeft:
      return [0, rect.h];
    case UIAnchor.BottomCenter:
      return [rect.w / 2, rect.h];
    case UIAnchor.BottomRight:
      return [rect.w, rect.h];
  }
}

function resolveSize(
  size: Vec2,
  units: UIUnits,
  parentRect: { x: number; y: number; w: number; h: number },
  canvasW: number,
  canvasH: number,
): [number, number] {
  let w = size[0];
  let h = size[1];

  switch (units) {
    case UIUnits.Percentage:
      w = (w / 100) * parentRect.w;
      h = (h / 100) * parentRect.h;
      break;
    case UIUnits.ViewportWidth:
      w = (w / 100) * canvasW;
      h = (h / 100) * canvasW;
      break;
    case UIUnits.ViewportHeight:
      w = (w / 100) * canvasH;
      h = (h / 100) * canvasH;
      break;
  }

  return [w, h];
}

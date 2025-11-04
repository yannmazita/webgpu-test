// src/core/ecs/components/ui/uiTransformComponent.ts
import { IComponent } from "@/core/ecs/component";
import { vec2, Vec2 } from "wgpu-matrix";

export enum UIAnchor {
  TopLeft,
  TopCenter,
  TopRight,
  MiddleLeft,
  MiddleCenter,
  MiddleRight,
  BottomLeft,
  BottomCenter,
  BottomRight,
}

export enum UIUnits {
  Pixels,
  Percentage,
  ViewportWidth,
  ViewportHeight,
}

export class UITransformComponent implements IComponent {
  public position: Vec2 = vec2.create(0, 0);
  public positionUnits: UIUnits = UIUnits.Pixels;

  public size: Vec2 = vec2.create(100, 100);
  public sizeUnits: UIUnits = UIUnits.Pixels;

  public anchor: UIAnchor = UIAnchor.TopLeft;
  public rotation = 0;
  public zIndex = 0;

  // Cached screen-space rect (computed by layout system)
  public screenRect: { x: number; y: number; w: number; h: number } = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  };

  public parent?: number; // Entity ID for hierarchical layout
}

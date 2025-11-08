// src/shared/ecs/components/ui/uiRenderComponent.ts
import { IComponent } from "@/shared/ecs/component";
import { vec4, Vec4 } from "wgpu-matrix";

/**
 * Represents a solid colored rectangle UI element
 */
export class UIRectComponent implements IComponent {
  public color: Vec4 = vec4.fromValues(1, 1, 1, 1);
  public borderRadius = 0;
  public borderWidth = 0;
  public borderColor: Vec4 = vec4.fromValues(0, 0, 0, 1);
}

/**
 * Represents an image-based UI element using a texture handle
 */
export class UIImageComponent implements IComponent {
  // Reference to texture via handle key
  public textureHandle?: string; // ie "UI_TEX:button_normal"
  public tint: Vec4 = vec4.fromValues(1, 1, 1, 1);
  public uvRect: Vec4 = vec4.fromValues(0, 0, 1, 1);
}

/**
 * Represents a nine-slice scalable image
 */
export class UINineSliceComponent implements IComponent {
  public textureHandle?: string;
  public tint: Vec4 = vec4.fromValues(1, 1, 1, 1);
  // Border sizes in pixels (left, top, right, bottom)
  public borders: Vec4 = vec4.fromValues(4, 4, 4, 4);
}

/**
 * Represents text content (rendered via canvas-to-texture)
 */
export class UITextComponent implements IComponent {
  public text = "";
  public fontFamily = "sans-serif";
  public fontSize = 16;
  public fontWeight = "normal";
  public color: Vec4 = vec4.fromValues(1, 1, 1, 1);
  public alignment: "left" | "center" | "right" = "left";
  public verticalAlignment: "top" | "middle" | "bottom" = "top";
  public lineHeight = 1.2;
  public maxWidth?: number;

  // Internal state for texture cache invalidation
  public _textureGeneration = 0;
  public _lastRenderedText = "";
  public _lastRenderedSize = 0;
  public _lastRenderedColor = "";
}

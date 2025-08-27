// src/core/types/rendering.ts
import { Light, Renderable } from "./gpu";
import { Vec4 } from "wgpu-matrix";

/**
 * A container for all the data required by the Renderer to render a single frame.
 * This decouples the Renderer from the scene management system (be it ECS or SceneGraph).
 */
export interface SceneRenderData {
  renderables: Renderable[];
  lights: Light[];
  ambientColor: Vec4;
}

// src/core/types/rendering.ts
import { Light, Renderable } from "./gpu";
import { Vec4, vec4 } from "wgpu-matrix";

/**
 * A container for all the data required by the Renderer to render a single frame.
 * This is a class with pre-allocated arrays to avoid GC pressure.
 */
export class SceneRenderData {
  public renderables: Renderable[] = [];
  public lights: Light[] = [];
  public ambientColor: Vec4 = vec4.create();

  /**
   * Clears the data arrays to prepare for the next frame's data.
   */
  public clear(): void {
    this.renderables.length = 0;
    this.lights.length = 0;
  }
}

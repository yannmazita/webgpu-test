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

  // fog parameters
  public fogColor: Vec4 = vec4.fromValues(0.6, 0.7, 0.8, 1.0);
  // [distanceDensity, height, heightFalloff, enableFlags]
  public fogParams0: Vec4 = vec4.fromValues(0.0, 0.0, 0.0, 0.0);
  public fogParams1: Vec4 = vec4.fromValues(0.0, 0.0, 0.0, 0.0); // reserved

  public clear(): void {
    this.renderables.length = 0;
    this.lights.length = 0;
    // ambientColor/fog params persist as scene configuration
  }
}

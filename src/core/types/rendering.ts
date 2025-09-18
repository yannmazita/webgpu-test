// src/core/types/rendering.ts
import { IBLComponent } from "../ecs/components/iblComponent";
import { MaterialInstance } from "../materials/materialInstance";
import { Light, Renderable } from "./gpu";
import { Vec4, vec4 } from "wgpu-matrix";

/**
 * A container for all the data required by the Renderer to render a single frame.
 * This is a class with pre-allocated arrays to avoid GC pressure.
 */
export class SceneRenderData {
  public renderables: Renderable[] = [];
  public lights: Light[] = [];
  public skyboxMaterial?: MaterialInstance;
  public iblComponent?: IBLComponent;
  public prefilteredMipLevels = 0;

  // fog parameters
  public fogEnabled = false;
  public fogColor: Vec4 = vec4.fromValues(0.5, 0.6, 0.7, 1.0);
  public fogDensity = 0.02;
  public fogHeight = 0.0;
  public fogHeightFalloff = 0.1;
  public fogInscatteringIntensity = 0.8;

  public clear(): void {
    this.renderables.length = 0;
    this.lights.length = 0;
    this.skyboxMaterial = undefined;
    this.iblComponent = undefined;
    this.prefilteredMipLevels = 0;
    this.fogEnabled = false; // Reset per frame
    // Default fog params remain
  }
}

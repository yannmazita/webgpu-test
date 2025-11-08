// src/shared/ecs/components/fogComponent.ts
import { IComponent } from "@/shared/ecs/component";
import { Vec4, vec4 } from "wgpu-matrix";

/**
 * A world resource component that defines the properties for volumetric fog.
 */
export class FogComponent implements IComponent {
  /** Whether the fog effect is active. */
  public enabled = true;

  /** The ambient color of the fog (in-scattering from sky/environment). */
  public color: Vec4 = vec4.fromValues(0.5, 0.6, 0.7, 1.0);

  /** The base density of the fog, affecting how quickly things are obscured. */
  public density = 0.02;

  /** The world-space Y coordinate where the fog is at its densest. */
  public height = 0.0;

  /** How quickly the fog density decreases with altitude above the fog height. */
  public heightFalloff = 0.1;

  /** The intensity of light scattered from the sun through the fog. */
  public inscatteringIntensity = 0.8;
}

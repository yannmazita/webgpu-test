// src/core/ecs/components/sunComponent.ts
import { IComponent } from "../component";
import { Vec3, vec3, Vec4, vec4 } from "wgpu-matrix";

/**
 * Scene-wide directional "sun" light. Used for shadow mapping and a primary
 * direct lighting term. Todo: extend to multiple directional lights.
 */
export class SceneSunComponent implements IComponent {
  /** Direction the light points toward (normalized). */
  public direction: Vec3 = vec3.fromValues(-0.4, -1.0, -0.2);
  /** Linear color (rgb) and intensity multiplier in w for convenience. */
  public color: Vec4 = vec4.fromValues(1.0, 1.0, 1.0, 1.0);
  /** Whether the sun is active. */
  public enabled = true;
  /** Whether the sun casts shadows. */
  public castsShadows = true;
}

/**
 * Global shadow quality/settings for the scene.
 */
export class ShadowSettingsComponent implements IComponent {
  /** Shadow map resolution (width=height). */
  public mapSize = 2048;
  /** Depth bias applied in shader compare (in [0,1] depth). */
  public depthBias = 0.0015;
  /** Raster slope-scale bias to reduce acne. */
  public slopeScaleBias = 3.0;
  /** Raster constant bias in depth units. */
  public constantBias = 1.0;
  /** PCF radius in texels for 3x3 kernel; 0 disables PCF. */
  public pcfRadius = 1.0;
  /** Half-extent of the ortho box for the MVP (MVP only). */
  public orthoHalfExtent = 20.0;
}

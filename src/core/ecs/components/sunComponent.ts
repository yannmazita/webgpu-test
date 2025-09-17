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
 * Global shadow quality and behavior settings for the scene, including
 * Cascaded Shadow Maps (CSM).
 */
export class ShadowSettingsComponent implements IComponent {
  /** Shadow map resolution (width=height). Higher values produce sharper shadows. */
  public mapSize = 2048;
  /** Number of cascades for CSM. Must be between 1 and 4. */
  public numCascades = 4;
  /**
   * Controls the distribution of cascades. 0 is fully linear, 1 is fully
   * logarithmic. A value around 0.7-0.8 is often a good starting point to
   * give more resolution to closer cascades.
   */
  public cascadeLambda = 0.75;
  /**
   * Constant depth bias added in the shader during the shadow comparison.
   * Helps prevent "shadow acne" on flat surfaces. Units are in normalized depth [0,1].
   */
  public depthBias = 0.0015;
  /**
   * Slope-scale depth bias applied by the rasterizer during the shadow pass.
   * Helps prevent "shadow acne" on surfaces at a steep angle to the light.
   */
  public slopeScaleBias = 3.0;
  /**
   * Constant depth bias applied by the rasterizer during the shadow pass.
   * Units are relative to the depth format's precision.
   */
  public constantBias = 1.0;
  /**
   * Radius for Percentage-Closer Filtering (PCF) in texels. A 3x3 kernel is
   * used. A value of 1.0 samples adjacent texels. 0 disables PCF.
   */
  public pcfRadius = 1.0;
  /**
   * DEPRECATED for CSM. Half-extent of the ortho box for a single-cascade MVP.
   * This is no longer used by the CSM implementation.
   */
  //public orthoHalfExtent = 20.0;
}

// src/shared/types/geometry.ts
import { Vec4, Vec3 } from "wgpu-matrix";

/**
 * Represents a light source in the scene.
 *
 */
export interface Light {
  /** Light position, vec4 and w=1 for padding purposes */
  position: Vec4;
  /** Light color, vec4 and w=1 for padding purposes */
  color: Vec4;
  /**
   * params0 = [range, intensity, type, pad0]
   * range: radius of effect (units)
   * intensity: scalar multiplier
   * type: 0=point, 1=directional, 2=spot (future)
   * pad0: explicit padding for 16-byte alignment
   */
  params0: Vec4;
}

/**
 * Axis-Aligned Bounding Box
 */
export interface AABB {
  min: Vec3;
  max: Vec3;
}

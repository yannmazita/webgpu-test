// src/core/utils/bounds.ts
import { vec3, Mat4, Vec4 } from "wgpu-matrix";
import { AABB } from "../types/gpu";

/**
 * Transforms an AABB by a 4x4 transformation matrix.
 * Uses the optimized method that avoids transforming all 8 corners.
 *
 * @param aabb The axis-aligned bounding box in local space
 * @param matrix The transformation matrix (typically a model matrix)
 * @param outAABB Optional output AABB to avoid allocation. If not provided, creates a new one.
 * @returns The transformed AABB in world space
 */
export function transformAABB(aabb: AABB, matrix: Mat4, outAABB?: AABB): AABB {
  const result = outAABB || { min: vec3.create(), max: vec3.create() };

  // Start with the translation component (matrix column 3)
  result.min[0] = result.max[0] = matrix[12];
  result.min[1] = result.max[1] = matrix[13];
  result.min[2] = result.max[2] = matrix[14];

  // For each local axis i, accumulate contribution along each world axis j
  // Column-major indexing: m[row=j, col=i] = matrix[i*4 + j]
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const mji = matrix[i * 4 + j]; // corrected indexing
      const a = mji * aabb.min[i];
      const b = mji * aabb.max[i];

      if (a < b) {
        result.min[j] += a;
        result.max[j] += b;
      } else {
        result.min[j] += b;
        result.max[j] += a;
      }
    }
  }

  return result;
}

/**
 * Tests if an AABB is completely outside any of the frustum planes.
 * Uses the "positive vertex" method for efficiency.
 *
 * @param aabb The axis-aligned bounding box to test
 * @param frustumPlanes Array of 6 planes as Vec4 [a,b,c,d] where ax+by+cz+d=0
 * @returns true if the AABB is inside or intersecting the frustum, false if completely outside
 */
export function testAABBFrustum(aabb: AABB, frustumPlanes: Vec4[]): boolean {
  for (let i = 0; i < 6; i++) {
    const plane = frustumPlanes[i];

    // Find the "positive vertex" - the corner of the AABB that is farthest along the plane normal
    const px = plane[0] >= 0 ? aabb.max[0] : aabb.min[0];
    const py = plane[1] >= 0 ? aabb.max[1] : aabb.min[1];
    const pz = plane[2] >= 0 ? aabb.max[2] : aabb.min[2];

    // If the positive vertex is outside this plane, the entire AABB is outside
    const distance = plane[0] * px + plane[1] * py + plane[2] * pz + plane[3];
    if (distance < 0) {
      return false; // AABB is completely outside this plane
    }
  }

  return true; // AABB is inside or intersecting the frustum
}

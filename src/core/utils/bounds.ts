// src/core/utils/bounds.ts
import { vec3, Mat4, Vec4, Vec3 } from "wgpu-matrix";
import { AABB } from "../types/gpu";

/**
 * Transforms an axis-aligned bounding box (AABB) by a 4x4 matrix.
 *
 * This function calculates the new world-space AABB of an object after it has
 * been transformed. It uses an optimized method that does not require
 * transforming all 8 corners of the box, making it efficient for culling and
 * collision detection prep work.
 *
 * @param aabb The AABB in local space.
 * @param matrix The transformation matrix (ex: a model matrix).
 * @param outAABB Optional. A pre-allocated AABB to store the result,
 *     avoiding a new allocation.
 * @returns The transformed AABB in world space.
 */
export function transformAABB(aabb: AABB, matrix: Mat4, outAABB?: AABB): AABB {
  const result = outAABB ?? { min: vec3.create(), max: vec3.create() };

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
 * Tests if an AABB is inside or intersecting with the view frustum.
 *
 * This function is a core part of frustum culling. It efficiently determines
 * if an object's bounding box is visible to the camera. It uses the
 * "positive vertex" optimization, which avoids checking all 8 corners of the
 * box against each frustum plane.
 *
 * @param aabb The AABB to test, typically in world space.
 * @param frustumPlanes An array of 6 planes defining the camera frustum.
 * @returns `true` if the AABB is at least partially inside the frustum,
 *     `false` if it is completely outside.
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

/**
 * Intersects a ray with an axis-aligned bounding box (AABB).
 *
 * This function implements the slab test, which is an efficient method for
 * determining if a ray intersects an AABB and finding the intersection distance.
 *
 * @param origin The origin of the ray.
 * @param direction The direction of the ray (must be normalized).
 * @param aabb The AABB to test against.
 * @returns The distance from the ray's origin to the intersection point,
 *     or `null` if there is no intersection.
 */
export function intersectRayWithAABB(
  origin: Vec3,
  direction: Vec3,
  aabb: AABB,
): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;

  for (let i = 0; i < 3; i++) {
    if (Math.abs(direction[i]) < 1e-6) {
      // Ray is parallel to the slab. If origin is not inside, no intersection.
      if (origin[i] < aabb.min[i] || origin[i] > aabb.max[i]) {
        return null;
      }
    } else {
      const invD = 1.0 / direction[i];
      let t1 = (aabb.min[i] - origin[i]) * invD;
      let t2 = (aabb.max[i] - origin[i]) * invD;

      if (t1 > t2) {
        [t1, t2] = [t2, t1]; // swap
      }

      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);

      if (tmin > tmax) {
        return null; // Box is missed
      }
    }
  }

  // If tmax is negative, ray is intersecting AABB behind its origin
  if (tmax < 0) {
    return null;
  }

  // If tmin is negative, ray's origin is inside the AABB
  if (tmin < 0) {
    return tmax;
  }

  return tmin;
}

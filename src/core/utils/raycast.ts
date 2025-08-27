// src/core/utils/raycast.ts
import { Camera } from "@/core/camera";
import { vec3, vec4, Vec3 } from "wgpu-matrix";

/**
 * Calculates the 3D world position corresponding to a 2D mouse coordinate,
 * by intersecting a ray with a virtual plane.
 *
 * @param mouseCoords The (x, y) coordinates of the mouse inside the canvas.
 * @param canvas The HTML canvas element.
 * @param camera The scene camera.
 * @param planeNormal The normal vector of the virtual plane to intersect with.
 * @param planePoint A point on the virtual plane.
 * @returns The 3D intersection point in world space, or null if no intersection occurs.
 */
export function getMouseWorldPosition(
  mouseCoords: { x: number; y: number },
  canvas: HTMLCanvasElement,
  camera: Camera,
  planeNormal: Vec3 = vec3.fromValues(0, 1, 0), // Default to XZ plane at Y=0
  planePoint: Vec3 = vec3.fromValues(0, 0, 0),
): Vec3 | null {
  // 1. Convert mouse coordinates to Normalized Device Coordinates (NDC)
  //    x: -1 to +1, y: -1 to +1
  const ndc_x = (mouseCoords.x / canvas.clientWidth) * 2 - 1;
  const ndc_y = 1 - (mouseCoords.y / canvas.clientHeight) * 2; // Y is inverted

  // 2. Unproject from NDC (clip space) to View Space
  //    We start at the near plane (z = -1) in clip space
  const clipCoords = vec4.fromValues(ndc_x, ndc_y, -1.0, 1.0);
  const viewCoords = vec4.transformMat4(
    clipCoords,
    camera.inverseProjectionMatrix,
  );

  // 3. Create a direction vector in View Space
  //    Set z to -1 (forward direction in view space) and w to 0 to make it a direction
  const viewDirection = vec4.fromValues(
    viewCoords[0],
    viewCoords[1],
    -1.0,
    0.0,
  );

  // 4. Unproject direction from View Space to World Space
  const worldDirectionVec4 = vec4.transformMat4(
    viewDirection,
    camera.inverseViewMatrix,
  );
  const worldDirection = vec3.normalize(
    vec3.fromValues(
      worldDirectionVec4[0],
      worldDirectionVec4[1],
      worldDirectionVec4[2],
    ),
  );

  // 5. Perform Ray-Plane Intersection
  //    Ray origin is the camera's position
  const rayOrigin = camera.position;

  const denominator = vec3.dot(planeNormal, worldDirection);

  // If the denominator is close to zero, the ray is parallel to the plane
  if (Math.abs(denominator) < 0.0001) {
    return null;
  }

  const t =
    vec3.dot(vec3.subtract(planePoint, rayOrigin), planeNormal) / denominator;

  // If t is negative, the intersection point is behind the camera
  if (t < 0) {
    return null;
  }

  // Calculate the intersection point
  const intersectionPoint = vec3.add(rayOrigin, vec3.scale(worldDirection, t));

  return intersectionPoint;
}

// src/core/utils/raycast.ts
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { vec3, vec4, Vec3, mat4 } from "wgpu-matrix";

/**
 * Calculates the 3D world position corresponding to a 2D mouse coordinate,
 * by intersecting a ray with a virtual plane.
 *
 * This version uses the canvas client size. For worker/OffscreenCanvas, prefer
 * getMouseWorldPositionWithViewport to pass numeric dimensions.
 */
export function getMouseWorldPosition(
  mouseCoords: { x: number; y: number },
  canvas: HTMLCanvasElement,
  cameraComp: CameraComponent,
  _cameraTransform: TransformComponent, // kept for compatibility; no longer required
  planeNormal: Vec3 = vec3.fromValues(0, 1, 0),
  planePoint: Vec3 = vec3.fromValues(0, 0, 0),
): Vec3 | null {
  const width = canvas.clientWidth || canvas.width || 0;
  const height = canvas.clientHeight || canvas.height || 0;
  return getMouseWorldPositionWithViewport(
    mouseCoords,
    width,
    height,
    cameraComp,
    planeNormal,
    planePoint,
  );
}

/**
 * Builds a world-space pick ray from a 2D mouse coordinate using the camera's inverse matrices.
 *
 * @param mouseCoords Mouse position in CSS pixels relative to the viewport (0..width, 0..height)
 * @param viewportWidth Viewport width in CSS pixels
 * @param viewportHeight Viewport height in CSS pixels
 * @param cameraComp Camera component providing inverseViewMatrix and inverseProjectionMatrix
 * @returns { origin, direction } where origin is camera position and direction is normalized
 */
export function getPickRay(
  mouseCoords: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
  cameraComp: CameraComponent,
): { origin: Vec3; direction: Vec3 } {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    // Degenerate viewport; return a benign ray
    return {
      origin: vec3.fromValues(
        cameraComp.inverseViewMatrix[12],
        cameraComp.inverseViewMatrix[13],
        cameraComp.inverseViewMatrix[14],
      ),
      direction: vec3.fromValues(0, 0, -1),
    };
  }

  // 1) NDC
  const ndcX = (mouseCoords.x / viewportWidth) * 2 - 1;
  const ndcY = 1 - (mouseCoords.y / viewportHeight) * 2;

  // 2) Clip-space points at near and far
  const nearClip = vec4.fromValues(ndcX, ndcY, -1.0, 1.0);
  const farClip = vec4.fromValues(ndcX, ndcY, 1.0, 1.0);

  // 3) Inverse View-Projection = inverseView * inverseProjection
  const invVP = mat4.multiply(
    cameraComp.inverseViewMatrix,
    cameraComp.inverseProjectionMatrix,
  );

  // 4) Unproject and perspective divide
  const worldNear4 = vec4.transformMat4(nearClip, invVP);
  const worldFar4 = vec4.transformMat4(farClip, invVP);

  const invWN = worldNear4[3] !== 0 ? 1.0 / worldNear4[3] : 1.0;
  const invWF = worldFar4[3] !== 0 ? 1.0 / worldFar4[3] : 1.0;

  const worldNear = vec3.fromValues(
    worldNear4[0] * invWN,
    worldNear4[1] * invWN,
    worldNear4[2] * invWN,
  );
  const worldFar = vec3.fromValues(
    worldFar4[0] * invWF,
    worldFar4[1] * invWF,
    worldFar4[2] * invWF,
  );

  // 5) Origin at camera position; direction toward far point
  const origin = vec3.fromValues(
    cameraComp.inverseViewMatrix[12],
    cameraComp.inverseViewMatrix[13],
    cameraComp.inverseViewMatrix[14],
  );

  const dir = vec3.normalize(vec3.subtract(worldFar, origin));

  return { origin, direction: dir };
}

/**
 * Intersects a ray with a plane.
 * @param origin Ray origin
 * @param direction Ray direction (normalized recommended)
 * @param planePoint A point on the plane
 * @param planeNormal Plane normal (does not need to be normalized)
 * @returns Intersection point or null if parallel or behind origin
 */
export function intersectRayWithPlane(
  origin: Vec3,
  direction: Vec3,
  planePoint: Vec3,
  planeNormal: Vec3,
): Vec3 | null {
  const denom = vec3.dot(planeNormal, direction);
  if (Math.abs(denom) < 1e-6) return null;

  const t = vec3.dot(vec3.subtract(planePoint, origin), planeNormal) / denom;
  if (t < 0) return null;

  return vec3.fromValues(
    origin[0] + direction[0] * t,
    origin[1] + direction[1] * t,
    origin[2] + direction[2] * t,
  );
}

/**
 * Worker/OffscreenCanvas-friendly helper: uses numeric viewport dimensions.
 *
 * @param mouseCoords Mouse position in CSS pixels relative to the viewport
 * @param viewportWidth CSS width
 * @param viewportHeight CSS height
 * @param cameraComp Camera component
 * @param planeNormal Plane normal (default Y-up)
 * @param planePoint A point on the plane (default origin)
 */
export function getMouseWorldPositionWithViewport(
  mouseCoords: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
  cameraComp: CameraComponent,
  planeNormal: Vec3 = vec3.fromValues(0, 1, 0),
  planePoint: Vec3 = vec3.fromValues(0, 0, 0),
): Vec3 | null {
  const { origin, direction } = getPickRay(
    mouseCoords,
    viewportWidth,
    viewportHeight,
    cameraComp,
  );
  return intersectRayWithPlane(origin, direction, planePoint, planeNormal);
}

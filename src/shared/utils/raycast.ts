// src/shared/utils/raycast.ts
import { CameraComponent } from "@/shared/ecs/components/clientOnly/cameraComponent";
import { TransformComponent } from "@/shared/ecs/components/gameplay/transformComponent";
import { vec3, vec4, Vec3, mat4 } from "wgpu-matrix";
import { World } from "@/shared/ecs/world";
import { Entity } from "@/shared/ecs/entity";
import { MeshRendererComponent } from "@/shared/ecs/components/clientOnly/meshRendererComponent";
import { intersectRayWithAABB, transformAABB } from "@/shared/utils/bounds";
import { AABB } from "@/shared/types/geometry";

/**
 * Represents the result of a successful raycast, containing information
 * about the hit entity and intersection point.
 */
export interface RaycastHit {
  entity: Entity;
  distance: number;
  point: Vec3;
}

/**
 * Calculates the 3D world position corresponding to a 2D mouse coordinate.
 *
 * This function creates a ray from the camera through the mouse cursor and
 * finds where it intersects with a virtual plane in the scene. This is
 * useful for things like placing objects or selecting points in the world.
 *
 * @param mouseCoords The 2D mouse coordinates.
 * @param canvas The HTML canvas element.
 * @param cameraComp The camera component.
 * @param _cameraTransform The camera transform component (deprecated).
 * @param planeNormal The normal of the virtual plane to intersect with.
 * @param planePoint A point on the virtual plane.
 * @returns The 3D world position, or null if the ray is parallel to the
 *     plane.
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
 * Creates a world-space ray from a 2D mouse coordinate.
 *
 * This function is the first step in raycasting. It takes a 2D screen
 * position and converts it into a 3D ray (an origin and a direction) in world
 * space. This ray can then be used for intersection tests with objects in the
 * scene.
 *
 * @param mouseCoords The 2D mouse coordinates.
 * @param viewportWidth The width of the viewport.
 * @param viewportHeight The height of the viewport.
 * @param cameraComp The camera component.
 * @returns An object containing the ray's origin and direction.
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

  // 1) Normalized Device Coordinates (NDC)
  const ndcX = (mouseCoords.x / viewportWidth) * 2 - 1;
  const ndcY = 1 - (mouseCoords.y / viewportHeight) * 2;

  // 2) Clip-space points at near (z=0) and far (z=1) for WebGPU
  const nearClip = vec4.fromValues(ndcX, ndcY, 0.0, 1.0);

  // 3) Inverse View-Projection matrix
  const invVP = mat4.multiply(
    cameraComp.inverseViewMatrix,
    cameraComp.inverseProjectionMatrix,
  );

  // 4) Unproject near point and perform perspective divide
  const worldNear4 = vec4.transformMat4(nearClip, invVP);
  const invWN = worldNear4[3] !== 0 ? 1.0 / worldNear4[3] : 1.0;

  const worldNear = vec3.fromValues(
    worldNear4[0] * invWN,
    worldNear4[1] * invWN,
    worldNear4[2] * invWN,
  );

  // 5) Ray origin is camera's world position.
  //    Direction is from the camera towards the unprojected near plane point.
  const origin = vec3.fromValues(
    cameraComp.inverseViewMatrix[12],
    cameraComp.inverseViewMatrix[13],
    cameraComp.inverseViewMatrix[14],
  );

  const dir = vec3.normalize(vec3.subtract(worldNear, origin));

  return { origin, direction: dir };
}

/**
 * Finds the intersection point of a ray and a plane.
 *
 * This is a fundamental geometric calculation used in raycasting. It
 * determines the point in 3D space where a given ray intersects with a plane.
 *
 * @param origin The origin of the ray.
 * @param direction The direction of the ray.
 * @param planePoint A point on the plane.
 * @param planeNormal The normal of the plane.
 * @returns The intersection point, or null if the ray is parallel to the
 *     plane or intersects behind the origin.
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
 * Calculates the 3D world position corresponding to a 2D mouse coordinate,
 * using numeric viewport dimensions.
 *
 * This function is a variant of `getMouseWorldPosition` that is suitable for
 * use in environments where there is no access to the DOM, such as web
 * workers.
 *
 * @param mouseCoords The 2D mouse coordinates.
 * @param viewportWidth The width of the viewport.
 * @param viewportHeight The height of the viewport.
 * @param cameraComp The camera component.
 * @param planeNormal The normal of the virtual plane to intersect with.
 * @param planePoint A point on the virtual plane.
 * @returns The 3D world position, or null if the ray is parallel to the
 *     plane.
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

/**
 * Performs a raycast against all renderable entities in the world.
 *
 * This function iterates through all entities with a `MeshRendererComponent`
 * and `TransformComponent`, transforms their local-space AABB into world space,
 * and performs a ray-AABB intersection test. It returns the closest hit.
 *
 * @param world The ECS world to cast against.
 * @param origin The origin of the ray in world space.
 * @param direction The normalized direction of the ray in world space.
 * @returns A `RaycastHit` object for the closest intersection, or `null` if no
 *     entity was hit.
 */
export function raycast(
  world: World,
  origin: Vec3,
  direction: Vec3,
): RaycastHit | null {
  console.log("[Raycast] Starting raycast against all renderables.");
  const query = world.query([MeshRendererComponent, TransformComponent]);
  let closestHit: RaycastHit | null = null;
  const tempAABB: AABB = { min: vec3.create(), max: vec3.create() };

  for (const entity of query) {
    const meshRenderer = world.getComponent(entity, MeshRendererComponent);
    const transform = world.getComponent(entity, TransformComponent);

    if (!meshRenderer || !transform) continue;

    const worldAABB = transformAABB(
      meshRenderer.mesh.aabb,
      transform.worldMatrix,
      tempAABB,
    );

    const distance = intersectRayWithAABB(origin, direction, worldAABB);

    if (distance !== null) {
      console.log(
        `[Raycast] ---> HIT entity ${entity} at distance ${distance.toFixed(2)}. World AABB Min: [${worldAABB.min[0].toFixed(2)}, ${worldAABB.min[1].toFixed(2)}, ${worldAABB.min[2].toFixed(2)}], Max: [${worldAABB.max[0].toFixed(2)}, ${worldAABB.max[1].toFixed(2)}, ${worldAABB.max[2].toFixed(2)}]`,
      );
      if (closestHit === null || distance < closestHit.distance) {
        const point = vec3.add(origin, vec3.scale(direction, distance));
        closestHit = { entity, distance, point };
      }
    }
  }

  console.log("[Raycast] Finished. Closest hit:", closestHit);
  return closestHit;
}

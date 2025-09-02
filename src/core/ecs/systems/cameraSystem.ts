// src/core/ecs/systems/cameraSystem.ts
import { Mat4, mat4, Vec4 } from "wgpu-matrix";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { World } from "@/core/ecs/world";

/**
 * Extracts frustum planes from a view-projection matrix.
 * Planes are stored as [a,b,c,d] where ax+by+cz+d=0.
 * Normals point inward (negative half-space is inside frustum).
 *
 * @param viewProjectionMatrix The combined view-projection matrix
 * @param outPlanes Array of 6 Vec4 to store the planes [left, right, bottom, top, near, far]
 */
function extractFrustumPlanes(
  viewProjectionMatrix: Mat4,
  outPlanes: Vec4[],
): void {
  const m = viewProjectionMatrix;

  // Left plane: row4 + row1
  outPlanes[0][0] = m[3] + m[0]; // a
  outPlanes[0][1] = m[7] + m[4]; // b
  outPlanes[0][2] = m[11] + m[8]; // c
  outPlanes[0][3] = m[15] + m[12]; // d

  // Right plane: row4 - row1
  outPlanes[1][0] = m[3] - m[0];
  outPlanes[1][1] = m[7] - m[4];
  outPlanes[1][2] = m[11] - m[8];
  outPlanes[1][3] = m[15] - m[12];

  // Bottom plane: row4 + row2
  outPlanes[2][0] = m[3] + m[1];
  outPlanes[2][1] = m[7] + m[5];
  outPlanes[2][2] = m[11] + m[9];
  outPlanes[2][3] = m[15] + m[13];

  // Top plane: row4 - row2
  outPlanes[3][0] = m[3] - m[1];
  outPlanes[3][1] = m[7] - m[5];
  outPlanes[3][2] = m[11] - m[9];
  outPlanes[3][3] = m[15] - m[13];

  // Near plane: row4 + row3
  outPlanes[4][0] = m[3] + m[2];
  outPlanes[4][1] = m[7] + m[6];
  outPlanes[4][2] = m[11] + m[10];
  outPlanes[4][3] = m[15] + m[14];

  // Far plane: row4 - row3
  outPlanes[5][0] = m[3] - m[2];
  outPlanes[5][1] = m[7] - m[6];
  outPlanes[5][2] = m[11] - m[10];
  outPlanes[5][3] = m[15] - m[14];

  // Normalize planes for consistent distance calculations
  for (let i = 0; i < 6; i++) {
    const plane = outPlanes[i];
    const length = Math.sqrt(
      plane[0] * plane[0] + plane[1] * plane[1] + plane[2] * plane[2],
    );
    if (length > 0) {
      plane[0] /= length;
      plane[1] /= length;
      plane[2] /= length;
      plane[3] /= length;
    }
  }
}

/**
 * Updates the view-related matrices of all camera entities.
 * This system should run AFTER the transformSystem but BEFORE the renderSystem.
 * @param world The world containing the entities.
 */
export function cameraSystem(world: World): void {
  const query = world.query([CameraComponent, TransformComponent]);

  for (const entity of query) {
    const camera = world.getComponent(entity, CameraComponent)!;
    const transform = world.getComponent(entity, TransformComponent)!;

    // The world matrix of the camera's transform is its inverse view matrix.
    // It represents the camera's position and orientation in world space.
    mat4.copy(transform.worldMatrix, camera.inverseViewMatrix);

    // The view matrix is the inverse of the camera's world matrix.
    mat4.invert(camera.inverseViewMatrix, camera.viewMatrix);

    // Pre-calculate the combined view-projection matrix for the shader.
    mat4.multiply(
      camera.projectionMatrix,
      camera.viewMatrix,
      camera.viewProjectionMatrix,
    );

    // Extract frustum planes from the view-projection matrix
    extractFrustumPlanes(camera.viewProjectionMatrix, camera.frustumPlanes);
  }
}

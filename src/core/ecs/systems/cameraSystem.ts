// src/core/ecs/systems/cameraSystem.ts
import { mat4 } from "wgpu-matrix";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { World } from "@/core/ecs/world";

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
  }
}

// src/core/ecs/systems/cameraControllerSystem.ts
import { ActionManager } from "@/core/actionManager";
import { vec3, quat } from "wgpu-matrix";
import { CameraComponent } from "../components/cameraComponent";
import { MainCameraTagComponent } from "../components/tagComponents";
import { World } from "../world";

export class CameraControllerSystem {
  // Configurable settings
  public moveSpeed = 5.0; // units per second
  public mouseSensitivity = 0.002;

  private actions: ActionManager;

  constructor(actions: ActionManager) {
    this.actions = actions;
  }

  public update(world: World, deltaTime: number): void {
    const query = world.query([CameraComponent, MainCameraTagComponent]);
    if (query.length === 0) {
      return; // No main camera found
    }
    const mainCameraEntity = query[0];
    const cameraComponent = world.getComponent(
      mainCameraEntity,
      CameraComponent,
    )!;
    const camera = cameraComponent.camera;

    // Rotation (Mouse Look)
    if (this.actions.isPointerLocked()) {
      const mouseDelta = this.actions.getMouseDelta();
      const yawAngle = mouseDelta.x * this.mouseSensitivity;
      const pitchAngle = -mouseDelta.y * this.mouseSensitivity;

      // Yaw (Horizontal) Rotation
      if (yawAngle !== 0) {
        const yawQuat = quat.fromAxisAngle(vec3.fromValues(0, 1, 0), yawAngle);
        vec3.transformQuat(camera.forward, yawQuat, camera.forward);
        vec3.transformQuat(camera.right, yawQuat, camera.right);
      }

      // Pitch (Vertical) Rotation
      if (pitchAngle !== 0) {
        const worldUp = vec3.fromValues(0, 1, 0);
        const pitchQuat = quat.fromAxisAngle(camera.right, pitchAngle);
        const potentialForward = vec3.transformQuat(camera.forward, pitchQuat);
        const dotProd = vec3.dot(potentialForward, worldUp);

        if (Math.abs(dotProd) < 0.995) {
          vec3.copy(potentialForward, camera.forward);
          vec3.transformQuat(camera.up, pitchQuat, camera.up);
        }
      }
      // Re-orthogonalize
      const worldUp = vec3.fromValues(0, 1, 0);
      vec3.cross(camera.forward, worldUp, camera.right);
      vec3.normalize(camera.right, camera.right);
      vec3.cross(camera.right, camera.forward, camera.up);
      vec3.normalize(camera.up, camera.up);
    }

    // Movement (Keyboard)
    const moveDirection = vec3.create(0, 0, 0);
    vec3.add(
      moveDirection,
      vec3.scale(camera.forward, this.actions.getAxis("move_vertical")),
      moveDirection,
    );
    vec3.add(
      moveDirection,
      vec3.scale(camera.right, this.actions.getAxis("move_horizontal")),
      moveDirection,
    );
    vec3.add(
      moveDirection,
      vec3.scale(camera.up, this.actions.getAxis("move_y_axis")),
      moveDirection,
    );

    if (vec3.lengthSq(moveDirection) > 0) {
      vec3.normalize(moveDirection, moveDirection);
      const moveVector = vec3.scale(moveDirection, this.moveSpeed * deltaTime);
      vec3.add(camera.position, moveVector, camera.position);
    }

    camera.updateViewMatrix();
  }
}

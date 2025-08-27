// src/core/cameraController.ts
import { vec3, quat } from "wgpu-matrix";
import { Camera } from "./camera";
import { ActionManager } from "./actionManager";

export class CameraController {
  private camera: Camera;
  private actions: ActionManager;

  // Configurable settings
  public moveSpeed = 5.0; // units per second
  public mouseSensitivity = 0.002;

  constructor(camera: Camera, actions: ActionManager) {
    this.camera = camera;
    this.actions = actions;
  }

  /**
   * Updates the camera position and orientation based on user input.
   * @param deltaTime The time in seconds since the last frame.
   */
  public update(deltaTime: number): void {
    // Rotation (Mouse Look)
    if (this.actions.isPointerLocked()) {
      const mouseDelta = this.actions.getMouseDelta();
      const yawAngle = mouseDelta.x * this.mouseSensitivity;
      const pitchAngle = -mouseDelta.y * this.mouseSensitivity;

      // Yaw (Horizontal) Rotation
      // Rotate around the world's up vector (0, 1, 0)
      if (yawAngle !== 0) {
        const yawQuat = quat.fromAxisAngle(vec3.fromValues(0, 1, 0), yawAngle);
        vec3.transformQuat(this.camera.forward, yawQuat, this.camera.forward);
        vec3.transformQuat(this.camera.right, yawQuat, this.camera.right);
      }

      // Pitch (Vertical) Rotation
      if (pitchAngle !== 0) {
        // Limiting pitch to prevent camera flipping
        // We check the angle between the current forward vector and the world up vector.
        const worldUp = vec3.fromValues(0, 1, 0);
        const pitchQuat = quat.fromAxisAngle(this.camera.right, pitchAngle);
        const potentialForward = vec3.transformQuat(
          this.camera.forward,
          pitchQuat,
        );
        const dotProd = vec3.dot(potentialForward, worldUp);

        // Allow rotation only if it doesn't push the camera over the top or bottom
        // 0.995 is about 5.7 degrees from vertical.
        if (Math.abs(dotProd) < 0.995) {
          vec3.copy(potentialForward, this.camera.forward);
          // rotate the camera's local 'up' vector
          vec3.transformQuat(this.camera.up, pitchQuat, this.camera.up);
        }
      }
      // Re-orthogonalize the camera's basis vectors to prevent drift.
      // (assuming the forward vector is the most correct after rotation)
      // The world up vector is used as a reference to maintain a stable roll.
      const worldUp = vec3.fromValues(0, 1, 0);
      vec3.cross(this.camera.forward, worldUp, this.camera.right);
      vec3.normalize(this.camera.right, this.camera.right);
      vec3.cross(this.camera.right, this.camera.forward, this.camera.up);
      vec3.normalize(this.camera.up, this.camera.up);
    }

    // Movement (Keyboard)
    const moveDirection = vec3.create(0, 0, 0);

    // Forward/Backward movement (local Z)
    const forwardMovement = vec3.scale(
      this.camera.forward,
      this.actions.getAxis("move_vertical"),
    );
    vec3.add(moveDirection, forwardMovement, moveDirection);

    // Strafe Left/Right movement (local X)
    const horizontalMovement = vec3.scale(
      this.camera.right,
      this.actions.getAxis("move_horizontal"),
    );
    vec3.add(moveDirection, horizontalMovement, moveDirection);

    // Up/Down movement (local Y)
    const upMovement = vec3.scale(
      this.camera.up,
      this.actions.getAxis("move_y_axis"),
    );
    vec3.add(moveDirection, upMovement, moveDirection);

    // Normalize move direction to prevent faster diagonal movement
    if (vec3.lengthSq(moveDirection) > 0) {
      vec3.normalize(moveDirection, moveDirection);
      const moveVector = vec3.scale(moveDirection, this.moveSpeed * deltaTime);
      vec3.add(this.camera.position, moveVector, this.camera.position);
    }

    // Update Camera
    this.camera.updateViewMatrix();
  }
}

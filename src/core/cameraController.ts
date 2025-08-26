// src/core/cameraController.ts
import { vec3 } from "wgpu-matrix";
import { Camera } from "./camera";
import { ActionManager } from "./actionManager";

export class CameraController {
  private camera: Camera;
  private actions: ActionManager;

  // Rotation state
  private yaw = 0;
  private pitch = 0;

  // Configurable settings
  public moveSpeed = 5.0; // units per second
  public mouseSensitivity = 0.002;

  constructor(camera: Camera, actions: ActionManager) {
    this.camera = camera;
    this.actions = actions;
    this.initializeOrientation();
  }

  /**
   * Calculates the initial yaw and pitch from the camera's starting orientation.
   */
  private initializeOrientation(): void {
    const viewDir = vec3.subtract(this.camera.target, this.camera.position);
    vec3.normalize(viewDir, viewDir);

    this.yaw = Math.atan2(viewDir[0], viewDir[2]);
    this.pitch = Math.asin(viewDir[1]);
  }

  /**
   * Updates the camera position and orientation based on user input.
   * @param deltaTime The time in seconds since the last frame.
   */
  public update(deltaTime: number): void {
    // --- Rotation (Mouse Look) ---
    if (this.actions.isPointerLocked()) {
      const mouseDelta = this.actions.getMouseDelta();
      this.yaw += mouseDelta.x * this.mouseSensitivity;
      this.pitch -= mouseDelta.y * this.mouseSensitivity;

      // Clamp pitch to prevent flipping
      const pitchLimit = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, this.pitch));
    }

    // Calculate forward, right, and up vectors from yaw and pitch
    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);
    const cosYaw = Math.cos(this.yaw);
    const sinYaw = Math.sin(this.yaw);

    const forward = vec3.fromValues(
      sinYaw * cosPitch,
      sinPitch,
      cosYaw * cosPitch,
    );
    const right = vec3.fromValues(cosYaw, 0, -sinYaw);

    // --- Movement (Keyboard) ---
    const moveDirection = vec3.create(0, 0, 0);
    // Create temporary vectors for movement calculation to avoid modifying the originals.
    const verticalMovement = vec3.scale(
      forward,
      this.actions.getAxis("move_vertical"),
    );
    const horizontalMovement = vec3.scale(
      right,
      this.actions.getAxis("move_horizontal"),
    );

    vec3.add(moveDirection, verticalMovement, moveDirection);
    vec3.add(moveDirection, horizontalMovement, moveDirection);
    if (this.actions.isPressed("move_up")) {
      moveDirection[1] += 1;
    }
    if (this.actions.isPressed("move_down")) {
      moveDirection[1] -= 1;
    }

    // Normalize move direction to prevent faster diagonal movement
    if (vec3.lengthSq(moveDirection) > 0) {
      vec3.normalize(moveDirection, moveDirection);
      const moveVector = vec3.scale(moveDirection, this.moveSpeed * deltaTime);
      vec3.add(this.camera.position, moveVector, this.camera.position);
    }

    // --- Update Camera ---
    const newTarget = vec3.add(this.camera.position, forward);
    this.camera.lookAt(
      this.camera.position,
      newTarget,
      vec3.fromValues(0, 1, 0),
    );
  }
}

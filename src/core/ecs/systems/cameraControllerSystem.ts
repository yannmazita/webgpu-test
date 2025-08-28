// src/core/ecs/systems/cameraControllerSystem.ts
import { ActionManager } from "@/core/actionManager";
import { vec3, quat } from "wgpu-matrix";
import { MainCameraTagComponent } from "../components/tagComponents";
import { TransformComponent } from "../components/transformComponent";
import { World } from "../world";

export class CameraControllerSystem {
  // Configurable settings
  public moveSpeed = 5.0; // units per second
  public mouseSensitivity = 0.002;

  // Internal state for rotation
  private pitch = 0;
  private yaw = 0;

  private actions: ActionManager;

  constructor(actions: ActionManager) {
    this.actions = actions;
  }

  public update(world: World, deltaTime: number): void {
    const query = world.query([MainCameraTagComponent, TransformComponent]);
    if (query.length === 0) {
      return; // No main camera found
    }
    const mainCameraEntity = query[0];
    const transform = world.getComponent(mainCameraEntity, TransformComponent)!;

    // --- Rotation (Mouse Look) ---
    if (this.actions.isPointerLocked()) {
      const mouseDelta = this.actions.getMouseDelta();

      // Update yaw and pitch based on mouse movement
      this.yaw -= mouseDelta.x * this.mouseSensitivity;
      this.pitch -= mouseDelta.y * this.mouseSensitivity;

      // Clamp pitch to prevent flipping
      const pitchLimit = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, this.pitch));

      // Combine yaw and pitch into a single quaternion
      const yawQuat = quat.fromAxisAngle([0, 1, 0], this.yaw);
      const pitchQuat = quat.fromAxisAngle([1, 0, 0], this.pitch);
      const finalRotation = quat.multiply(yawQuat, pitchQuat);
      quat.normalize(finalRotation, finalRotation);

      transform.setRotation(finalRotation);
    }

    // --- Movement (Keyboard) ---
    const move_vertical = this.actions.getAxis("move_vertical");
    const move_horizontal = this.actions.getAxis("move_horizontal");
    const move_y_axis = this.actions.getAxis("move_y_axis");

    if (move_vertical === 0 && move_horizontal === 0 && move_y_axis === 0) {
      // No movement input, so we might not need to dirty the transform.
      // We return here because the rotation logic above already dirties the transform if needed.
      return;
    }

    // Get camera's local axes from its world matrix.
    // The camera looks down its local -Z axis.
    const forward = vec3.fromValues(
      -transform.worldMatrix[8],
      -transform.worldMatrix[9],
      -transform.worldMatrix[10],
    );
    const right = vec3.fromValues(
      transform.worldMatrix[0],
      transform.worldMatrix[1],
      transform.worldMatrix[2],
    );

    const moveDirection = vec3.create(0, 0, 0);
    vec3.add(moveDirection, vec3.scale(forward, move_vertical), moveDirection);
    vec3.add(moveDirection, vec3.scale(right, move_horizontal), moveDirection);
    // Use world's up vector for vertical movement to prevent strange drift
    vec3.add(moveDirection, vec3.scale([0, 1, 0], move_y_axis), moveDirection);

    if (vec3.lengthSq(moveDirection) > 0) {
      vec3.normalize(moveDirection, moveDirection);
      const moveVector = vec3.scale(moveDirection, this.moveSpeed * deltaTime);
      transform.translate(moveVector);
    }
  }
}

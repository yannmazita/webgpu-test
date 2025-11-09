// src/shared/ecs/systems/clientOnly/cameraControllerSystem.ts
import { MainCameraTagComponent } from "@/shared/ecs/components/clientOnly/tagComponents";
import { TransformComponent } from "@/shared/ecs/components/gameplay/transformComponent";
import { World } from "@/shared/ecs/world";
import { vec3, quat, mat4, Mat4 } from "wgpu-matrix";
import {
  ActionState,
  MouseInput,
} from "@/shared/ecs/components/resources/inputResources";

export class CameraControllerSystem {
  public moveSpeed = 5.0;
  public mouseSensitivity = 0.002;

  private pitch = 0;
  private yaw = 0;

  private world: World;

  // Reusable temporaries
  private tmpForward = vec3.create();
  private tmpRight = vec3.create();
  private tmpMoveDir = vec3.create();
  private tmpScaled = vec3.create();
  private tmpQuat = quat.identity();
  private tmpRotMat: Mat4 = mat4.identity();

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Synchronizes the controller's internal pitch and yaw with an existing
   * transform's rotation.
   *
   * This is crucial for seamless switching from an animated camera to a
   * user-controlled one, preventing a jarring "snap" in orientation. It
   * decomposes the quaternion into the specific Euler angle sequence (Yaw,
   * then Pitch) used by this controller.
   *
   * @param transform The TransformComponent to synchronize from.
   */
  public syncFromTransform(transform: TransformComponent): void {
    const q = transform.rotation;
    const x = q[0],
      y = q[1],
      z = q[2],
      w = q[3];

    // Decompose quaternion to get pitch (around local X) and yaw (around world Y)
    // This specific decomposition matches the controller's rotation logic.
    // Yaw from quaternion
    const siny_cosp = 2 * (w * y + z * x);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    this.yaw = Math.atan2(siny_cosp, cosy_cosp);

    // Pitch from quaternion
    const sinp = 2 * (w * x - y * z);
    if (Math.abs(sinp) >= 1) {
      this.pitch = Math.sign(sinp) * (Math.PI / 2); // Use 90 degrees if looking straight up/down
    } else {
      this.pitch = Math.asin(sinp);
    }
  }

  /**
   * Updates the camera's position and orientation based on user input.
   *
   * This method implements a first-person-style camera control scheme. It
   * translates abstract user actions (like 'move_forward', mouse movement)
   * into changes in the camera's TransformComponent.
   *
   * @param deltaTime The time elapsed since the last frame, in seconds.
   */
  public update(deltaTime: number): void {
    const actionState = this.world.getResource(ActionState);
    const mouseInput = this.world.getResource(MouseInput);
    if (!actionState || !mouseInput) return;

    const query = this.world.query([
      MainCameraTagComponent,
      TransformComponent,
    ]);
    if (query.length === 0) return;

    const mainCameraEntity = query[0];
    const transform = this.world.getComponent(
      mainCameraEntity,
      TransformComponent,
    );
    if (!transform) return;

    // Mouse look
    if (mouseInput.isPointerLocked) {
      const mouseDelta = mouseInput.delta;
      this.yaw -= mouseDelta.x * this.mouseSensitivity;
      this.pitch -= mouseDelta.y * this.mouseSensitivity;

      const pitchLimit = Math.PI / 2 - 0.01;
      if (this.pitch > pitchLimit) this.pitch = pitchLimit;
      else if (this.pitch < -pitchLimit) this.pitch = -pitchLimit;

      quat.identity(this.tmpQuat);
      quat.rotateY(this.tmpQuat, this.yaw, this.tmpQuat);
      quat.rotateX(this.tmpQuat, this.pitch, this.tmpQuat);
      transform.setRotation(this.tmpQuat);
    }

    // Movement input
    const mv = actionState.axes.get("move_vertical") ?? 0;
    const mh = actionState.axes.get("move_horizontal") ?? 0;
    const my = actionState.axes.get("move_y_axis") ?? 0;
    if (mv === 0 && mh === 0 && my === 0) return;

    // Derive axes from rotation matrix to match worldMatrix convention:
    // right = column 0, forward = -column 2
    mat4.fromQuat(transform.rotation, this.tmpRotMat);

    // Right (+X)
    this.tmpRight[0] = this.tmpRotMat[0];
    this.tmpRight[1] = this.tmpRotMat[1];
    this.tmpRight[2] = this.tmpRotMat[2];

    // Forward (-Z)
    this.tmpForward[0] = -this.tmpRotMat[8];
    this.tmpForward[1] = -this.tmpRotMat[9];
    this.tmpForward[2] = -this.tmpRotMat[10];

    // tmpMoveDir = forward*mv + right*mh + worldUp*my
    this.tmpMoveDir[0] = 0;
    this.tmpMoveDir[1] = 0;
    this.tmpMoveDir[2] = 0;

    if (mv !== 0) {
      vec3.scale(this.tmpForward, mv, this.tmpScaled);
      vec3.add(this.tmpMoveDir, this.tmpScaled, this.tmpMoveDir);
    }
    if (mh !== 0) {
      vec3.scale(this.tmpRight, mh, this.tmpScaled);
      vec3.add(this.tmpMoveDir, this.tmpScaled, this.tmpMoveDir);
    }
    if (my !== 0) {
      this.tmpScaled[0] = 0;
      this.tmpScaled[1] = my;
      this.tmpScaled[2] = 0;
      vec3.add(this.tmpMoveDir, this.tmpScaled, this.tmpMoveDir);
    }

    // Proper float check: move if length^2 > epsilon (avoid allocations)
    const lenSq =
      this.tmpMoveDir[0] * this.tmpMoveDir[0] +
      this.tmpMoveDir[1] * this.tmpMoveDir[1] +
      this.tmpMoveDir[2] * this.tmpMoveDir[2];
    if (lenSq > 1e-12) {
      vec3.normalize(this.tmpMoveDir, this.tmpMoveDir);
      const s = this.moveSpeed * deltaTime;
      this.tmpScaled[0] = this.tmpMoveDir[0] * s;
      this.tmpScaled[1] = this.tmpMoveDir[1] * s;
      this.tmpScaled[2] = this.tmpMoveDir[2] * s;
      transform.translate(this.tmpScaled);
    }
  }
}

// src/core/ecs/systems/cameraControllerSystem.ts
import { ActionManager } from "@/core/actionManager";
import { MainCameraTagComponent } from "../components/tagComponents";
import { TransformComponent } from "../components/transformComponent";
import { World } from "../world";
import { vec3, quat, mat4, Mat4 } from "wgpu-matrix";

export class CameraControllerSystem {
  public moveSpeed = 5.0;
  public mouseSensitivity = 0.002;

  private pitch = 0;
  private yaw = 0;

  private actions: ActionManager;

  // Reusable temporaries
  private tmpForward = vec3.create();
  private tmpRight = vec3.create();
  private tmpMoveDir = vec3.create();
  private tmpScaled = vec3.create();
  private tmpQuat = quat.identity();
  private tmpRotMat: Mat4 = mat4.identity();

  constructor(actions: ActionManager) {
    this.actions = actions;
  }

  public update(world: World, deltaTime: number): void {
    const query = world.query([MainCameraTagComponent, TransformComponent]);
    if (query.length === 0) return;

    const mainCameraEntity = query[0];
    const transform = world.getComponent(mainCameraEntity, TransformComponent)!;

    // Mouse look
    if (this.actions.isPointerLocked()) {
      const mouseDelta = this.actions.getMouseDelta();
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
    const mv = this.actions.getAxis("move_vertical");
    const mh = this.actions.getAxis("move_horizontal");
    const my = this.actions.getAxis("move_y_axis");
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

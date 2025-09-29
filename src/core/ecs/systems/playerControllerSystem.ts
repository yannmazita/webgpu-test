// src/core/ecs/systems/playerControllerSystem.ts
import { IActionController } from "@/core/input/action";
import { PlayerControllerComponent } from "../components/playerControllerComponent";
import { PhysicsBodyComponent } from "../components/physicsComponents";
import { TransformComponent } from "../components/transformComponent";
import { World } from "../world";
import { quat, vec3 } from "wgpu-matrix";
import { MainCameraTagComponent } from "../components/tagComponents";
import { PhysicsContext, tryEnqueueCommand } from "@/core/physicsState";
import { CMD_MOVE_PLAYER } from "@/core/sharedPhysicsLayout";

export class PlayerControllerSystem {
  // Reusable temporaries to avoid per-frame allocations
  private tmpDesiredMovement = vec3.create();
  private tmpRightScaled = vec3.create();
  private tmpCameraOffset = vec3.fromValues(0, 1.6, 0);
  private tmpCameraPos = vec3.create();
  private tmpForward = vec3.create();
  private tmpRight = vec3.create();

  constructor(
    private actions: IActionController,
    private physCtx: PhysicsContext,
  ) {}

  public update(world: World, deltaTime: number): void {
    const query = world.query([
      PlayerControllerComponent,
      PhysicsBodyComponent,
      TransformComponent,
    ]);
    if (query.length === 0) return;

    const playerEntity = query[0];
    const controller = world.getComponent(
      playerEntity,
      PlayerControllerComponent,
    );
    const body = world.getComponent(playerEntity, PhysicsBodyComponent);
    const transform = world.getComponent(playerEntity, TransformComponent);

    if (!controller || !body || !transform) return;

    // Mouse look
    if (this.actions.isPointerLocked()) {
      const mouseDelta = this.actions.getMouseDelta();
      controller.yaw -= mouseDelta.x * controller.sensitivity;
      controller.pitch -= mouseDelta.y * controller.sensitivity;

      const pitchLimit = Math.PI / 2 - 0.01;
      controller.pitch = Math.max(
        -pitchLimit,
        Math.min(pitchLimit, controller.pitch),
      );

      // Body rotates on Y axis (yaw)
      const bodyRotation = quat.fromEuler(0, controller.yaw, 0, "yxz");
      transform.setRotation(bodyRotation);
    }

    // Movement input
    const moveVertical = this.actions.getAxis("move_vertical");
    const moveHorizontal = this.actions.getAxis("move_horizontal");
    const jumpJustPressed = this.actions.wasPressed("jump");

    // Get forward/right vectors from body's transform
    vec3.transformQuat(
      vec3.fromValues(0, 0, -1),
      transform.rotation,
      this.tmpForward,
    );
    vec3.transformQuat(
      vec3.fromValues(1, 0, 0),
      transform.rotation,
      this.tmpRight,
    );

    // Reset desired movement
    vec3.zero(this.tmpDesiredMovement);

    // Calculate horizontal movement
    vec3.scale(this.tmpForward, moveVertical, this.tmpDesiredMovement);
    vec3.scale(this.tmpRight, moveHorizontal, this.tmpRightScaled);
    vec3.add(
      this.tmpDesiredMovement,
      this.tmpRightScaled,
      this.tmpDesiredMovement,
    );

    // We are sending a displacement vector, so it must be scaled by speed and dt
    const lenSq = vec3.lengthSq(this.tmpDesiredMovement);
    if (lenSq > 0.001) {
      vec3.normalize(this.tmpDesiredMovement, this.tmpDesiredMovement);
      vec3.scale(
        this.tmpDesiredMovement,
        controller.moveSpeed * deltaTime,
        this.tmpDesiredMovement,
      );
    }

    // Handle jump: add an upward displacement. The physics worker will add gravity.
    if (jumpJustPressed && controller.onGround) {
      // This is a simple impulse.
      // todo: manage a velocity vector.
      this.tmpDesiredMovement[1] += controller.jumpForce * deltaTime;
    }

    // Enqueue command to physics worker
    if (this.physCtx && body.physId !== 0) {
      tryEnqueueCommand(this.physCtx, CMD_MOVE_PLAYER, body.physId, [
        this.tmpDesiredMovement[0],
        this.tmpDesiredMovement[1],
        this.tmpDesiredMovement[2],
      ]);
    }

    // Camera follow logic
    const cameraQuery = world.query([
      MainCameraTagComponent,
      TransformComponent,
    ]);
    if (cameraQuery.length > 0) {
      const cameraEntity = cameraQuery[0];
      const cameraTransform = world.getComponent(
        cameraEntity,
        TransformComponent,
      );
      if (cameraTransform) {
        // Position camera at player's head
        vec3.add(transform.position, this.tmpCameraOffset, this.tmpCameraPos);
        cameraTransform.setPosition(this.tmpCameraPos);

        // Camera rotates with both yaw and pitch for FPS view
        const cameraRotation = quat.fromEuler(
          controller.pitch,
          controller.yaw,
          0,
          "yxz",
        );
        cameraTransform.setRotation(cameraRotation);
      }
    }
  }
}

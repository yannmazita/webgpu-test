// src/shared/ecs/systems/playerControllerSystem.ts
import { PlayerControllerComponent } from "@/shared/ecs/components/playerControllerComponent";
import { PhysicsBodyComponent } from "@/shared/ecs/components/physicsComponents";
import { TransformComponent } from "@/shared/ecs/components/transformComponent";
import { World } from "@/shared/ecs/world";
import { quat, vec3 } from "wgpu-matrix";
import { PhysicsContext, tryEnqueueCommand } from "@/shared/state/physicsState";
import { CMD_MOVE_PLAYER } from "@/shared/state/sharedPhysicsLayout";
import {
  ActionState,
  MouseInput,
} from "@/shared/ecs/components/resources/inputResources";

// A reasonable gravity value for a game-like feel.
const GRAVITY = -18.0;

export class PlayerControllerSystem {
  // Reusable temporaries
  private tmpForward = vec3.create();
  private tmpRight = vec3.create();
  private tmpHorizontalMovement = vec3.create();
  private tmpDesiredDisplacement = vec3.create();

  private world: World;
  private physCtx: PhysicsContext;

  constructor(world: World, physCtx: PhysicsContext) {
    this.world = world;
    this.physCtx = physCtx;
  }

  /**
   * Updates the player's state based on user input and physics feedback.
   *
   * @param world The ECS world instance, used to query for the player
   *     entity and its components.
   */
  public update(deltaTime: number): void {
    const actionState = this.world.getResource(ActionState);
    const mouseInput = this.world.getResource(MouseInput);
    if (!actionState || !mouseInput) return;

    const query = this.world.query([
      PlayerControllerComponent,
      PhysicsBodyComponent,
      TransformComponent,
    ]);
    if (query.length === 0) return;

    const playerEntity = query[0];
    const controller = this.world.getComponent(
      playerEntity,
      PlayerControllerComponent,
    );
    const body = this.world.getComponent(playerEntity, PhysicsBodyComponent);
    const transform = this.world.getComponent(playerEntity, TransformComponent);

    if (!controller || !body || !transform) return;

    // --- Mouse Look ---
    // Updates internal pitch state and player body's yaw transform.
    if (mouseInput.isPointerLocked) {
      const mouseDelta = mouseInput.delta;
      controller.yaw -= mouseDelta.x * controller.sensitivity;
      controller.pitch -= mouseDelta.y * controller.sensitivity;

      const pitchLimit = Math.PI / 2 - 0.01;
      controller.pitch = Math.max(
        -pitchLimit,
        Math.min(pitchLimit, controller.pitch),
      );

      // Apply yaw rotation to the player's body transform. Pitch is only
      // stored on the component for the cameraFollowSystem to use.
      const bodyRotation = quat.fromEuler(0, controller.yaw, 0, "yxz");
      transform.setRotation(bodyRotation);
    }

    // --- Player Velocity and Displacement Calculation ---

    // 1. Apply gravity every frame to the vertical velocity.
    controller.velocity[1] += GRAVITY * deltaTime;

    // 2. Handle ground-specific logic like jumping and velocity clamping.
    if (controller.onGround) {
      // When on the ground, prevent downward velocity from accumulating.
      // A small negative velocity helps keep the character controller "stuck"
      // to the ground, improving stability of the ground check.
      if (controller.velocity[1] < 0) {
        controller.velocity[1] = -1.0;
      }

      // If a jump is requested and we are on the ground, execute it.
      if (actionState.justPressed.has("jump")) {
        controller.velocity[1] = controller.jumpForce;
      }
    }

    // 3. Calculate the desired horizontal movement direction from input.
    const moveVertical = actionState.axes.get("move_vertical") ?? 0;
    const moveHorizontal = actionState.axes.get("move_horizontal") ?? 0;

    // Derive forward and right vectors from the player's current rotation.
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

    // Combine input axes into a normalized horizontal movement vector.
    vec3.zero(this.tmpHorizontalMovement);
    const forwardScaled = vec3.scale(this.tmpForward, moveVertical);
    const rightScaled = vec3.scale(this.tmpRight, moveHorizontal);
    vec3.add(
      this.tmpHorizontalMovement,
      forwardScaled,
      this.tmpHorizontalMovement,
    );
    vec3.add(
      this.tmpHorizontalMovement,
      rightScaled,
      this.tmpHorizontalMovement,
    );

    if (vec3.lengthSq(this.tmpHorizontalMovement) > 0.001) {
      vec3.normalize(this.tmpHorizontalMovement, this.tmpHorizontalMovement);
    }

    // 4. Combine horizontal and vertical motion into a final displacement
    // vector for the frame.
    this.tmpDesiredDisplacement[0] =
      this.tmpHorizontalMovement[0] * controller.moveSpeed * deltaTime;
    this.tmpDesiredDisplacement[2] =
      this.tmpHorizontalMovement[2] * controller.moveSpeed * deltaTime;
    this.tmpDesiredDisplacement[1] = controller.velocity[1] * deltaTime;

    // 5. Enqueue the final displacement vector to the physics worker. The
    // physics worker will use its character controller to compute the actual
    // movement, handling collisions and sliding.
    if (this.physCtx && body.physId !== 0) {
      tryEnqueueCommand(this.physCtx, CMD_MOVE_PLAYER, body.physId, [
        this.tmpDesiredDisplacement[0],
        this.tmpDesiredDisplacement[1],
        this.tmpDesiredDisplacement[2],
      ]);
    }
  }
}

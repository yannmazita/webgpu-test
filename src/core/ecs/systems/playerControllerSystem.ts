// src/core/ecs/systems/playerControllerSystem.ts
import { IActionController } from "@/core/input/action";
import { PlayerControllerComponent } from "../components/playerControllerComponent";
import { PhysicsBodyComponent } from "../components/physicsComponents";
import { TransformComponent } from "../components/transformComponent";
import { World } from "../world";
import { quat, vec3 } from "wgpu-matrix";
import { PhysicsContext, tryEnqueueCommand } from "@/core/physicsState";
import { CMD_MOVE_PLAYER } from "@/core/sharedPhysicsLayout";

// A reasonable gravity value for a game-like feel.
const GRAVITY = -18.0;

export class PlayerControllerSystem {
  // Reusable temporaries to avoid per-frame allocations
  private tmpForward = vec3.create();
  private tmpRight = vec3.create();
  private tmpHorizontalMovement = vec3.create();
  private tmpDesiredDisplacement = vec3.create();

  constructor(
    private actions: IActionController,
    private physCtx: PhysicsContext,
  ) {}

  /**
   * Updates the player's state based on user input and physics feedback.
   *
   * This method is the core of the player controller, executed every frame. It
   * translates user input into a desired movement vector and sends it to the
   * physics worker for execution.
   *
   * @remarks
   * This system orchestrates several key behaviors:
   * 1.  **Mouse Look**: It reads mouse movement to update the `pitch` and `yaw`
   *     properties on the {@link PlayerControllerComponent}. Crucially, it only
   *     applies the `yaw` (horizontal rotation) to the player's body
   *     transform. The `pitch` (vertical rotation) is used by the
   *     `cameraFollowSystem` to orient the first-person camera.
   * 2.  **Jumping**: It processes the "jump" action, applying an upward
   *     velocity impulse only when the character controller reports being on
   *     the ground.
   * 3.  **Velocity Calculation**: It manages vertical velocity by applying
   *     gravity each frame. When the player is grounded, it clamps downward
   *     velocity to ensure stability and prevent gravity from accumulating.
   * 4.  **Movement Calculation**: It determines the desired horizontal movement
   *     direction from keyboard input (WASD) relative to the player's
   *     current yaw.
   * 5.  **Physics Command**: It assembles a final displacement vector for the
   *     frame (combining horizontal movement and vertical velocity) and
   *     enqueues it as a `CMD_MOVE_PLAYER` command. The physics worker is
   *     responsible for executing this movement, handling all collisions,
   *     sliding, and step-climbing logic.
   *
   * @param world The ECS world instance, used to query for the player
   *     entity and its components.
   * @param deltaTime The time elapsed since the last frame in
   *     seconds, used for frame-rate independent movement calculations.
   */
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

    // --- Mouse Look ---
    // Updates internal pitch state and player body's yaw transform.
    if (this.actions.isPointerLocked()) {
      const mouseDelta = this.actions.getMouseDelta();
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
      if (this.actions.wasPressed("jump")) {
        controller.velocity[1] = controller.jumpForce;
      }
    }

    // 3. Calculate the desired horizontal movement direction from input.
    const moveVertical = this.actions.getAxis("move_vertical");
    const moveHorizontal = this.actions.getAxis("move_horizontal");

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

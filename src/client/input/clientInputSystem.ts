// src/client/input/clientInputSystem.ts

import { World } from "@/shared/ecs/world";
import { PlayerControllerComponent } from "@/shared/ecs/components/gameplay/playerControllerComponent";
import { TransformComponent } from "@/shared/ecs/components/gameplay/transformComponent";
import { ActionState, MouseInput } from "@/shared/ecs/components/resources/inputResources";
import { PlayerInputMessage, MessageType } from "@/shared/network/protocol";
import { quat, vec3 } from "wgpu-matrix";

// Placeholder for network sending mechanism
interface NetworkChannel {
  send(message: PlayerInputMessage): void;
}

const GRAVITY = -18.0;

/**
 * CLIENT-SIDE system.
 * Reads local hardware input, sends it to the server, and applies it
 * locally for client-side prediction.
 */
export class ClientInputSystem {
  private network: NetworkChannel; // This will be the WebSocket connection
  private clientTick = 0;

  // Reusable temporaries for prediction logic
  private tmpForward = vec3.create();
  private tmpRight = vec3.create();
  private tmpHorizontalMovement = vec3.create();

  constructor(networkChannel: NetworkChannel) {
    this.network = networkChannel; // this will be the websocket networking class
  }

  public update(world: World, deltaTime: number): void {
    const actionState = world.getResource(ActionState);
    const mouseInput = world.getResource(MouseInput);
    if (!actionState || !mouseInput) return;

    const query = world.query([PlayerControllerComponent, TransformComponent]);
    if (query.length === 0) return;

    const playerEntity = query[0];
    const controller = world.getComponent(playerEntity, PlayerControllerComponent);
    const transform = world.getComponent(playerEntity, TransformComponent);

    if (!controller || !transform) return;

    // --- 1. Handle Mouse Look (Client-side only) ---
    if (mouseInput.isPointerLocked) {
      controller.yaw -= mouseInput.delta.x * controller.sensitivity;
      controller.pitch -= mouseInput.delta.y * controller.sensitivity;

      const pitchLimit = Math.PI / 2 - 0.01;
      controller.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, controller.pitch));

      // On the client, we only apply yaw to the body's transform.
      // The cameraFollowSystem will use the pitch to orient the camera.
      const bodyRotation = quat.fromEuler(0, controller.yaw, 0, "yxz");
      transform.setRotation(bodyRotation);
    }

    // --- 2. Package Input into a Network Message ---
    const moveHorizontal = actionState.axes.get("move_horizontal") ?? 0;
    const moveVertical = actionState.axes.get("move_vertical") ?? 0;
    const jumpPressed = actionState.justPressed.has("jump");

    let buttonMask = 0;
    if (jumpPressed) {
      buttonMask |= 1; // Bit 0 = Jump
    }
    // Add other buttons like fire, crouch, etc. to the mask here.

    const inputMessage: PlayerInputMessage = {
      type: MessageType.PLAYER_INPUT,
      tick: this.clientTick++,
      deltaTime,
      buttonMask,
      moveHorizontal,
      moveVertical,
      pitch: controller.pitch,
      yaw: controller.yaw,
    };

    // --- 3. Send Input to Server ---
    this.network.send(inputMessage);

    // --- 4. Apply Input for Client-Side Prediction ---
    // This logic mirrors what the server will do, providing immediate feedback.
    this.predictMovement(controller, transform, inputMessage, deltaTime);
  }

  /**
   * Applies movement logic locally for instant feedback.
   * This is the core of client-side prediction.
   */
  private predictMovement(
    controller: PlayerControllerComponent,
    transform: TransformComponent,
    input: PlayerInputMessage,
    deltaTime: number
  ): void {
    // Apply gravity
    controller.velocity[1] += GRAVITY * deltaTime;

    // Handle jumping
    if (controller.onGround && (input.buttonMask & 1)) {
      controller.velocity[1] = controller.jumpForce;
    }

    // Clamp vertical velocity when on ground
    if (controller.onGround && controller.velocity[1] < 0) {
      controller.velocity[1] = -1.0; // Keep slightly grounded
    }

    // Calculate horizontal movement based on the transform's current rotation
    vec3.transformQuat(vec3.fromValues(0, 0, -1), transform.rotation, this.tmpForward);
    vec3.transformQuat(vec3.fromValues(1, 0, 0), transform.rotation, this.tmpRight);

    vec3.zero(this.tmpHorizontalMovement);
    vec3.add(this.tmpHorizontalMovement, vec3.scale(this.tmpForward, input.moveVertical), this.tmpHorizontalMovement);
    vec3.add(this.tmpHorizontalMovement, vec3.scale(this.tmpRight, input.moveHorizontal), this.tmpHorizontalMovement);

    if (vec3.lengthSq(this.tmpHorizontalMovement) > 0.001) {
      vec3.normalize(this.tmpHorizontalMovement, this.tmpHorizontalMovement);
    }

    // Simple prediction for testing, it just moves the transform directly.
    // todo: more advanced prediction running a minimal physics step.
    const displacementX = this.tmpHorizontalMovement[0] * controller.moveSpeed * deltaTime;
    const displacementZ = this.tmpHorizontalMovement[2] * controller.moveSpeed * deltaTime;
    const displacementY = controller.velocity[1] * deltaTime;

    transform.position[0] += displacementX;
    transform.position[1] += displacementY;
    transform.position[2] += displacementZ;
    transform.isDirty = true;
  }
}

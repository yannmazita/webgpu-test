// src/server/game/systems/playerMovementSystem.ts

import { World } from "@/shared/ecs/world";
import { PlayerControllerComponent } from "@/shared/ecs/components/gameplay/playerControllerComponent";
import { TransformComponent } from "@/shared/ecs/components/gameplay/transformComponent";
import { PhysicsBodyComponent } from "@/shared/ecs/components/physics/physicsComponents";
import { PlayerInputMessage } from "@/shared/network/protocol";
import { PhysicsContext, tryEnqueueCommand } from "@/shared/state/physicsState";
import { CMD_MOVE_PLAYER } from "@/shared/state/sharedPhysicsLayout";
import { quat, vec3 } from "wgpu-matrix";
import { Entity } from "@/shared/ecs/entity";

const GRAVITY = -18.0;

/**
 * SERVER-SIDE system.
 * Receives validated player input messages from the network and applies
 * them to the authoritative player entity in the physics simulation.
 */
export class PlayerMovementSystem {
  // Reusable temporaries
  private tmpForward = vec3.create();
  private tmpRight = vec3.create();
  private tmpHorizontalMovement = vec3.create();
  private tmpDesiredDisplacement = vec3.create();

  constructor(private physCtx: PhysicsContext) {}

  public applyInput(world: World, playerEntity: Entity, input: PlayerInputMessage): void {
    const controller = world.getComponent(playerEntity, PlayerControllerComponent);
    const transform = world.getComponent(playerEntity, TransformComponent);
    const body = world.getComponent(playerEntity, PhysicsBodyComponent);

    if (!controller || !transform || !body) {
      return;
    }

    // --- 1. Update Authoritative State from Input ---
    // The server trusts the client's aim direction.
    controller.yaw = input.yaw;
    controller.pitch = input.pitch;

    // Apply yaw to the server-side body transform.
    const bodyRotation = quat.fromEuler(0, controller.yaw, 0, "yxz");
    transform.setRotation(bodyRotation);

    // --- 2. Calculate Authoritative Movement ---
    // This logic mirrors the client's prediction logic but operates on server state.
    controller.velocity[1] += GRAVITY * input.deltaTime;

    if (controller.onGround && (input.buttonMask & 1)) { // Check jump bit
      controller.velocity[1] = controller.jumpForce;
    }

    if (controller.onGround && controller.velocity[1] < 0) {
      controller.velocity[1] = -1.0;
    }

    vec3.transformQuat(vec3.fromValues(0, 0, -1), transform.rotation, this.tmpForward);
    vec3.transformQuat(vec3.fromValues(1, 0, 0), transform.rotation, this.tmpRight);

    vec3.zero(this.tmpHorizontalMovement);
    vec3.add(this.tmpHorizontalMovement, vec3.scale(this.tmpForward, input.moveVertical), this.tmpHorizontalMovement);
    vec3.add(this.tmpHorizontalMovement, vec3.scale(this.tmpRight, input.moveHorizontal), this.tmpHorizontalMovement);

    if (vec3.lengthSq(this.tmpHorizontalMovement) > 0.001) {
      vec3.normalize(this.tmpHorizontalMovement, this.tmpHorizontalMovement);
    }

    this.tmpDesiredDisplacement[0] = this.tmpHorizontalMovement[0] * controller.moveSpeed * input.deltaTime;
    this.tmpDesiredDisplacement[2] = this.tmpHorizontalMovement[2] * controller.moveSpeed * input.deltaTime;
    this.tmpDesiredDisplacement[1] = controller.velocity[1] * input.deltaTime;

    // --- 3. Enqueue Command to Server's Physics Worker ---
    if (body.physId !== 0) {
      tryEnqueueCommand(this.physCtx, CMD_MOVE_PLAYER, body.physId, [
        this.tmpDesiredDisplacement[0],
        this.tmpDesiredDisplacement[1],
        this.tmpDesiredDisplacement[2],
      ]);
    }
  }
}

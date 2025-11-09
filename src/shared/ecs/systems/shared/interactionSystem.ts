// src/shared/ecs/systems/shared/interactionSystem.ts
import { World } from "@/shared/ecs/world";
import { PhysicsContext, tryEnqueueCommand } from "@/shared/state/physicsState";
import {
  CMD_INTERACTION_RAYCAST,
  INTERACTION_RAYCAST_RESULTS_GEN_OFFSET,
  INTERACTION_RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET,
  INTERACTION_RAYCAST_RESULTS_HIT_DISTANCE_OFFSET,
} from "@/shared/state/sharedPhysicsLayout";
import { CameraComponent } from "@/shared/ecs/components/clientOnly/cameraComponent";
import { MainCameraTagComponent } from "@/shared/ecs/components/clientOnly/tagComponents";
import { TransformComponent } from "@/shared/ecs/components/gameplay/transformComponent";
import { vec3 } from "wgpu-matrix";
import { EventManager } from "@/shared/ecs/events/eventManager";
import { Entity } from "@/shared/ecs/entity";
import { InteractableComponent } from "@/shared/ecs/components/gameplay/interactableComponent";
import { PlayerControllerComponent } from "@/shared/ecs/components/gameplay/playerControllerComponent";
import { ActionState } from "../../components/resources/inputResources";

// Reusable temporaries
const rayOrigin = vec3.create();
const rayDirection = vec3.create();

/**
 * Detects interactable objects the player is looking at and handles interaction input.
 *
 * @remarks
 * This system performs a raycast from the camera's perspective each frame to
 * determine what the player is aiming at. It manages the current interaction
 * target, publishing events when the target changes so the UI can update.
 * When the player presses the "interact" key, it publishes an `InteractEvent`.
 */
export class InteractionSystem {
  private lastRaycastGen = 0;
  private currentTarget: Entity | null = null;

  constructor(
    private world: World,
    private eventManager: EventManager,
    private physCtx: PhysicsContext,
    private interactionRaycastResultsCtx: { i32: Int32Array },
  ) {}

  public update(): void {
    const actionState = this.world.getResource(ActionState);
    if (!actionState) return;

    // 1. Find player and camera for raycasting
    const playerQuery = this.world.query([PlayerControllerComponent]);
    if (playerQuery.length === 0) return;
    const playerEntity = playerQuery[0];

    const cameraQuery = this.world.query([
      MainCameraTagComponent,
      CameraComponent,
      TransformComponent,
    ]);
    if (cameraQuery.length === 0) return;
    const cameraTransform = this.world.getComponent(
      cameraQuery[0],
      TransformComponent,
    );
    if (!cameraTransform) return;

    // 2. Enqueue a raycast command
    vec3.set(
      cameraTransform.worldMatrix[12],
      cameraTransform.worldMatrix[13],
      cameraTransform.worldMatrix[14],
      rayOrigin,
    );
    vec3.set(
      -cameraTransform.worldMatrix[8],
      -cameraTransform.worldMatrix[9],
      -cameraTransform.worldMatrix[10],
      rayDirection,
    );
    vec3.normalize(rayDirection, rayDirection);

    tryEnqueueCommand(this.physCtx, CMD_INTERACTION_RAYCAST, playerEntity, [
      rayOrigin[0],
      rayOrigin[1],
      rayOrigin[2],
      rayDirection[0],
      rayDirection[1],
      rayDirection[2],
      5.0, // Max interaction range
    ]);

    // 3. Check for new raycast results
    const currentGen = Atomics.load(
      this.interactionRaycastResultsCtx.i32,
      INTERACTION_RAYCAST_RESULTS_GEN_OFFSET >> 2,
    );

    let newTarget: Entity | null = null;

    if (currentGen !== this.lastRaycastGen) {
      this.lastRaycastGen = currentGen;

      const hitEntityId = Atomics.load(
        this.interactionRaycastResultsCtx.i32,
        INTERACTION_RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET >> 2,
      );

      const hitDistanceBits = Atomics.load(
        this.interactionRaycastResultsCtx.i32,
        INTERACTION_RAYCAST_RESULTS_HIT_DISTANCE_OFFSET >> 2,
      );
      const hitDistance = new Float32Array(
        new Int32Array([hitDistanceBits]).buffer,
      )[0];

      if (hitEntityId !== 0) {
        const interactable = this.world.getComponent(
          hitEntityId,
          InteractableComponent,
        );
        // Also check that hitDistance is valid (>= 0)
        if (
          interactable &&
          hitDistance >= 0 &&
          hitDistance <= interactable.interactionDistance
        ) {
          newTarget = hitEntityId;
        }
      }
    } else {
      // No new result, keep old target if it's still valid
      newTarget = this.currentTarget;
    }

    // 4. Compare with previous target and publish events
    if (newTarget !== this.currentTarget) {
      this.currentTarget = newTarget;
      const prompt = newTarget
        ? (this.world.getComponent(newTarget, InteractableComponent)
            ?.promptMessage ?? null)
        : null;

      this.eventManager.publish({
        type: "interaction-target-changed",
        payload: { newTarget: this.currentTarget, prompt },
      });
    }

    // 5. Check for interaction input
    if (actionState.justPressed.has("interact") && this.currentTarget) {
      this.eventManager.publish({
        type: "interact",
        payload: {
          interactor: playerEntity,
          target: this.currentTarget,
        },
      });
    }
  }
}

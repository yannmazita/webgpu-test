// src/app/physicsWorker/commands.ts
import { state } from "@/app/physicsWorker/state";
import {
  COMMANDS_RING_CAPACITY,
  COMMANDS_SLOT_OFFSET,
  COMMANDS_SLOT_SIZE,
  COMMANDS_HEAD_OFFSET,
  COMMANDS_TAIL_OFFSET,
  COMMANDS_GEN_OFFSET,
  CMD_CREATE_BODY,
  CMD_DESTROY_BODY,
  CMD_MOVE_PLAYER,
  CMD_WEAPON_RAYCAST,
  CMD_INTERACTION_RAYCAST,
  COMMANDS_MAX_PARAMS_F32,
  RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET,
  RAYCAST_RESULTS_HIT_DISTANCE_OFFSET,
  RAYCAST_RESULTS_GEN_OFFSET,
  RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET,
  INTERACTION_RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET,
  INTERACTION_RAYCAST_RESULTS_HIT_DISTANCE_OFFSET,
  INTERACTION_RAYCAST_RESULTS_GEN_OFFSET,
  INTERACTION_RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET,
  CMD_CREATE_BODY_PARAMS,
} from "@/core/sharedPhysicsLayout";
import { floatToInt32Bits } from "@/core/utils/bitConversion";
import {
  getRapierModule,
  ColliderDesc,
  RigidBody,
  RigidBodyDesc,
} from "@/core/wasm/rapierModule";

export function processCommands(): void {
  const RAPIER = getRapierModule();
  if (!state.commandsView || !state.world || !RAPIER) {
    return;
  }

  let tail = Atomics.load(state.commandsView, COMMANDS_TAIL_OFFSET >> 2);
  const head = Atomics.load(state.commandsView, COMMANDS_HEAD_OFFSET >> 2);

  const slotBaseI32 = COMMANDS_SLOT_OFFSET >> 2;
  let processedAny = false;

  while (tail !== head) {
    const slotIndex = tail % COMMANDS_RING_CAPACITY;
    const slotIndexI32 = slotIndex * (COMMANDS_SLOT_SIZE >> 2);
    const slotByteOffset =
      COMMANDS_SLOT_OFFSET + slotIndex * COMMANDS_SLOT_SIZE;

    const type = Atomics.load(
      state.commandsView,
      slotBaseI32 + slotIndexI32 + 0,
    );
    const physId = Atomics.load(
      state.commandsView,
      slotBaseI32 + slotIndexI32 + 1,
    );

    const paramsView = new Float32Array(
      state.commandsView.buffer,
      slotByteOffset + 8,
      COMMANDS_MAX_PARAMS_F32,
    );

    if (type === CMD_CREATE_BODY) {
      const P = CMD_CREATE_BODY_PARAMS;
      const colliderType = Math.floor(paramsView[P.COLLIDER_TYPE]);
      const p0 = paramsView[P.PARAM_0],
        p1 = paramsView[P.PARAM_1],
        p2 = paramsView[P.PARAM_2];
      const pos = {
        x: paramsView[P.POS_X],
        y: paramsView[P.POS_Y],
        z: paramsView[P.POS_Z],
      };
      const rot = {
        x: paramsView[P.ROT_X],
        y: paramsView[P.ROT_Y],
        z: paramsView[P.ROT_Z],
        w: paramsView[P.ROT_W],
      };
      const bodyTypeInt = Math.floor(paramsView[P.BODY_TYPE]);
      const isPlayer = paramsView[P.IS_PLAYER] > 0.5;
      const slopeAngle = paramsView[P.SLOPE_ANGLE];
      const maxStepHeight = paramsView[P.MAX_STEP_HEIGHT];
      const vel = {
        x: paramsView[P.VEL_X],
        y: paramsView[P.VEL_Y],
        z: paramsView[P.VEL_Z],
      };

      let bodyDesc: RigidBodyDesc;
      switch (bodyTypeInt) {
        case 0:
          bodyDesc = RAPIER.RigidBodyDesc.dynamic();
          break;
        case 1:
          bodyDesc = RAPIER.RigidBodyDesc.fixed();
          break;
        case 2:
          bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
          break;
        case 3:
          bodyDesc = RAPIER.RigidBodyDesc.kinematicVelocityBased();
          break;
        default:
          console.warn(
            `[PhysicsWorker] Unknown body type ${bodyTypeInt}, defaulting to dynamic.`,
          );
          bodyDesc = RAPIER.RigidBodyDesc.dynamic();
      }
      bodyDesc.setTranslation(pos.x, pos.y, pos.z).setRotation(rot);
      if (vel.x !== 0 || vel.y !== 0 || vel.z !== 0) {
        bodyDesc.setLinvel(vel.x, vel.y, vel.z);
      }

      const body: RigidBody = state.world.createRigidBody(bodyDesc);

      let colliderDesc: ColliderDesc | null = null;
      switch (colliderType) {
        case 0:
          colliderDesc = RAPIER.ColliderDesc.ball(Math.max(0.001, p0));
          break;
        case 1:
          colliderDesc = RAPIER.ColliderDesc.cuboid(
            Math.max(0.001, p0),
            Math.max(0.001, p1),
            Math.max(0.001, p2),
          );
          break;
        case 2: {
          const radius = Math.max(0.001, p0);
          const halfHeight = Math.max(0.001, p1);
          colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
          break;
        }
        default:
          console.warn(
            `[PhysicsWorker] Unknown collider type ${colliderType} for ID=${physId}; skipping.`,
          );
      }

      if (colliderDesc) {
        colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        state.world.createCollider(colliderDesc, body);

        if (isPlayer) {
          const controller = state.world.createCharacterController(0.1);
          controller.setUp({ x: 0.0, y: 1.0, z: 0.0 });
          controller.setMaxSlopeClimbAngle(slopeAngle);
          controller.enableAutostep(maxStepHeight, 0.2, true);
          controller.enableSnapToGround(0.5);
          state.entityToController.set(physId, controller);
          state.playerOnGround.set(physId, 0.0);
          state.playerSliding.set(physId, false);
        }
        state.entityToBody.set(physId, body);
        state.bodyToEntity.set(body, physId);
      } else {
        state.world.removeRigidBody(body);
      }
      processedAny = true;
    } else if (type === CMD_DESTROY_BODY) {
      const body = state.entityToBody.get(physId);
      if (body) {
        const controller = state.entityToController.get(physId);
        if (controller) {
          state.world.removeCharacterController(controller);
          state.entityToController.delete(physId);
        }
        state.playerOnGround.delete(physId);
        state.playerSliding.delete(physId);
        state.world.removeRigidBody(body);
        state.entityToBody.delete(physId);
        state.bodyToEntity.delete(body);
      }
      processedAny = true;
    } else if (type === CMD_MOVE_PLAYER) {
      const body = state.entityToBody.get(physId);
      const controller = state.entityToController.get(physId);
      const collider = body?.collider(0);

      if (body && controller && collider) {
        const disp = { x: paramsView[0], y: paramsView[1], z: paramsView[2] };
        controller.computeColliderMovement(collider, disp);
        const correctedMovement = controller.computedMovement();
        const currentPos = body.translation();
        const nextPos = {
          x: currentPos.x + correctedMovement.x,
          y: currentPos.y + correctedMovement.y,
          z: currentPos.z + correctedMovement.z,
        };
        body.setNextKinematicTranslation(nextPos);
        const isOnGround = controller.computedGrounded();
        state.playerOnGround.set(physId, isOnGround ? 1.0 : 0.0);
      }
      processedAny = true;
    } else if (type === CMD_WEAPON_RAYCAST) {
      if (state.raycastResultsI32 && state.raycastResultsF32) {
        const origin = {
          x: paramsView[0],
          y: paramsView[1],
          z: paramsView[2],
        };
        const dir = { x: paramsView[3], y: paramsView[4], z: paramsView[5] };
        const maxToi = paramsView[6];
        const ray = new RAPIER.Ray(origin, dir);
        const playerBody = state.entityToBody.get(physId);

        const hit = state.world.castRayAndGetNormal(
          ray,
          maxToi,
          true,
          undefined,
          undefined,
          undefined,
          playerBody,
        );

        if (hit) {
          const hitPoint = ray.pointAt(hit.timeOfImpact);
          const hitBody = hit.collider.parent();
          const hitEntityId = hitBody
            ? (state.bodyToEntity.get(hitBody) ?? 0)
            : 0;

          Atomics.store(
            state.raycastResultsI32,
            RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET >> 2,
            hitEntityId,
          );
          state.raycastResultsF32.set(
            [hit.timeOfImpact, hitPoint.x, hitPoint.y, hitPoint.z],
            RAYCAST_RESULTS_HIT_DISTANCE_OFFSET >> 2,
          );
        } else {
          Atomics.store(
            state.raycastResultsI32,
            RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET >> 2,
            0,
          );
        }
        Atomics.store(
          state.raycastResultsI32,
          RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET >> 2,
          physId,
        );
        Atomics.add(
          state.raycastResultsI32,
          RAYCAST_RESULTS_GEN_OFFSET >> 2,
          1,
        );
      }
      processedAny = true;
    } else if (type === CMD_INTERACTION_RAYCAST) {
      if (state.interactionRaycastResultsI32) {
        const origin = {
          x: paramsView[0],
          y: paramsView[1],
          z: paramsView[2],
        };
        const dir = { x: paramsView[3], y: paramsView[4], z: paramsView[5] };
        const maxToi = paramsView[6];
        const ray = new RAPIER.Ray(origin, dir);
        const sourceBody = state.entityToBody.get(physId);

        const hit = state.world.castRay(
          ray,
          maxToi,
          true,
          undefined,
          undefined,
          undefined,
          sourceBody,
        );

        let hitEntityId = 0;
        let hitDistance = -1.0;

        if (hit) {
          const hitBody = hit.collider.parent();
          hitEntityId = hitBody ? (state.bodyToEntity.get(hitBody) ?? 0) : 0;
          hitDistance = hit.timeOfImpact;
        }

        Atomics.store(
          state.interactionRaycastResultsI32,
          INTERACTION_RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET >> 2,
          hitEntityId,
        );
        Atomics.store(
          state.interactionRaycastResultsI32,
          INTERACTION_RAYCAST_RESULTS_HIT_DISTANCE_OFFSET >> 2,
          floatToInt32Bits(hitDistance),
        );
        Atomics.store(
          state.interactionRaycastResultsI32,
          INTERACTION_RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET >> 2,
          physId,
        );
        Atomics.add(
          state.interactionRaycastResultsI32,
          INTERACTION_RAYCAST_RESULTS_GEN_OFFSET >> 2,
          1,
        );
      }
      processedAny = true;
    }

    tail = (tail + 1) % COMMANDS_RING_CAPACITY;
    Atomics.store(state.commandsView, COMMANDS_TAIL_OFFSET >> 2, tail);
  }

  if (processedAny) {
    Atomics.add(state.commandsView, COMMANDS_GEN_OFFSET >> 2, 1);
  }
}

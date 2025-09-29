// src/core/ecs/systems/physicsCommandSystem.ts
import { World } from "../world";
import { PhysicsBodyComponent } from "../components/physicsComponents";
import { PhysicsColliderComponent } from "../components/physicsComponents";
import { PhysicsContext, tryEnqueueCommand } from "@/core/physicsState";
import { CMD_CREATE_BODY, CMD_DESTROY_BODY } from "@/core/sharedPhysicsLayout";
import { TransformComponent } from "../components/transformComponent";
import { PlayerControllerComponent } from "../components/playerControllerComponent";

/**
 * System that detects physics entity lifecycle changes and enqueues commands
 * to the physics worker via the commands SAB ring buffer.
 *
 * Runs each frame: Compares current physics entities (with PhysicsBodyComponent)
 * to previous frame's set. Enqueues CREATE for new, DESTROY for removed.
 * Logs actions; drops on full ring (rare).
 *
 * No stepping or visuals—async via SAB. Assumes physics worker is running.
 */
export class PhysicsCommandSystem {
  private prevPhysicsEntities = new Set<number>();

  constructor(private physCtx: PhysicsContext) {}

  /**
   * Updates the system: Detects adds/removes and enqueues commands.
   * @param world ECS world.
   */
  public update(world: World): void {
    const currentPhysicsEntities = new Set(world.query([PhysicsBodyComponent]));

    // Detect creates (new entities with PhysicsBodyComponent)
    for (const entity of currentPhysicsEntities) {
      if (!this.prevPhysicsEntities.has(entity)) {
        this.enqueueCreate(world, entity);
      }
    }

    // Detect destroys (entities removed from set)
    for (const entity of this.prevPhysicsEntities) {
      if (!currentPhysicsEntities.has(entity)) {
        this.enqueueDestroy(entity);
      }
    }

    // Update previous set
    this.prevPhysicsEntities = currentPhysicsEntities;
  }

  /**
   * Enqueues CREATE_BODY for a new physics entity.
   * Packs params: [colliderType, param0, param1, param2, posX, posY, posZ, rotX, rotY, rotZ, rotW, mass(1=static/0=dynamic)].
   * Sets physId on component after enqueue (optimistic; physics worker assigns final ID).
   * @param world ECS world.
   * @param entity Entity ID.
   */
  private enqueueCreate(world: World, entity: number): void {
    const bodyComp = world.getComponent(entity, PhysicsBodyComponent);
    const colliderComp = world.getComponent(entity, PhysicsColliderComponent);
    const transformComp = world.getComponent(entity, TransformComponent);
    const playerComp = world.getComponent(entity, PlayerControllerComponent);

    if (!bodyComp || !colliderComp) {
      console.warn(
        `[PhysicsCommandSystem] Skipping CREATE for ${entity}: missing body/collider component.`,
      );
      return;
    }

    // Map bodyType to int: 0=dynamic, 1=fixed, 2=kinematicPosition, 3=kinematicVelocity
    const bodyTypeInt = (() => {
      switch (bodyComp.bodyType) {
        case "dynamic":
          return 0;
        case "fixed":
          return 1;
        case "kinematicPosition":
          return 2;
        case "kinematicVelocity":
          return 3;
        default:
          return 0;
      }
    })();

    // Pack params (16 floats)
    const params: number[] = [
      colliderComp.type,
      colliderComp.params[0],
      colliderComp.params[1],
      colliderComp.params[2],
      transformComp ? transformComp.position[0] : 0,
      transformComp ? transformComp.position[1] : 0,
      transformComp ? transformComp.position[2] : 0,
      transformComp ? transformComp.rotation[0] : 0,
      transformComp ? transformComp.rotation[1] : 0,
      transformComp ? transformComp.rotation[2] : 0,
      transformComp ? transformComp.rotation[3] : 1,
      bodyTypeInt, // bodyType (0-3)
      bodyComp.isPlayer ? 1.0 : 0.0,
    ];

    // If player, set [13-16]: controller params (pad rest if not)
    if (bodyComp.isPlayer && playerComp) {
      params[13] = playerComp.slopeAngle;
      params[14] = playerComp.maxStepHeight;
      params[15] = playerComp.slideEnabled ? 1.0 : 0.0;
      params[16] = playerComp.maxSlopeForGround;
    } else {
      // Pad [13-16]=0 for non-player
      params[13] = 0;
      params[14] = 0;
      params[15] = 0;
      params[16] = 0;
    }

    const physId = entity;
    bodyComp.physId = physId;

    if (tryEnqueueCommand(this.physCtx, CMD_CREATE_BODY, physId, params)) {
      const msg = bodyComp.isPlayer
        ? `[PhysicsCommandSystem] Queued CREATE_PLAYER for entity ${entity} (ID=${physId}, kinematic, capsule).`
        : `[PhysicsCommandSystem] Queued CREATE_BODY for entity ${entity} (ID=${physId}, type=${bodyComp.bodyType}).`;
      console.log(msg);
    } else {
      console.warn(
        `[PhysicsCommandSystem] Dropped CREATE for ${entity}: ring full.`,
      );
    }
  }

  /**
   * Enqueues DESTROY_BODY for a removed physics entity.
   * @param entity Entity ID.
   */
  private enqueueDestroy(entity: number): void {
    const physId = entity; // PHYS_ID == entity ID

    if (tryEnqueueCommand(this.physCtx, CMD_DESTROY_BODY, physId, [])) {
      console.log(
        `[PhysicsCommandSystem] Queued DESTROY_BODY for entity ${entity} (ID=${physId}).`,
      );
    } else {
      console.warn(
        `[PhysicsCommandSystem] Dropped DESTROY for ${entity}: ring full.`,
      );
    }
  }
}

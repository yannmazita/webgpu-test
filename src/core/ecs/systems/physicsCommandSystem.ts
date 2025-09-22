// src/core/ecs/systems/physicsCommandSystem.ts
import { World } from "../world";
import { PhysicsBodyComponent } from "../components/physicsComponents";
import { PhysicsColliderComponent } from "../components/physicsComponents";
import { PhysicsContext, tryEnqueueCommand } from "@/core/physicsState";
import { CMD_CREATE_BODY, CMD_DESTROY_BODY } from "@/core/sharedPhysicsLayout";
import { vec3, quat } from "wgpu-matrix";
import { TransformComponent } from "../components/transformComponent";

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

    if (!bodyComp || !colliderComp) {
      console.warn(
        `[PhysicsCommandSystem] Skipping CREATE for ${entity}: missing body/collider component.`,
      );
      return;
    }

    // Default mass: 1 for static, 0 for dynamic (Rapier convention)
    const mass = bodyComp.isDynamic ? 1.0 : 0.0;

    // Pack params (12 floats)
    const params: number[] = [
      colliderComp.type, // 0=sphere,1=box,2=capsule
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
      mass,
    ];

    const physId = entity; // Mirror entity ID as PHYS_ID
    bodyComp.physId = physId;

    if (tryEnqueueCommand(this.physCtx, CMD_CREATE_BODY, physId, params)) {
      console.log(
        `[PhysicsCommandSystem] Queued CREATE_BODY for entity ${entity} (ID=${physId}, type=${colliderComp.type}, dynamic=${bodyComp.isDynamic}).`,
      );
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

// src/client/runtime/loop.ts
import { state } from "@/client/runtime/state";
import { World } from "@/shared/ecs/world";
import { PhysicsBodyComponent } from "@/shared/ecs/components/physicsComponents";
import { TransformComponent } from "@/shared/ecs/components/transformComponent";
import { PlayerControllerComponent } from "@/shared/ecs/components/playerControllerComponent";
import {
  STATES_GEN_OFFSET,
  STATES_WRITE_INDEX_OFFSET,
  STATES_SLOT_COUNT,
  STATES_SLOT_OFFSET,
  STATES_SLOT_SIZE,
  STATES_MAX_BODIES,
} from "@/shared/state/sharedPhysicsLayout";
import { PhysicsContext } from "@/shared/state/physicsState";

/**
 * Applies the latest physics snapshot to the ECS world.
 *
 * @remarks
 * Reads from the triple-buffered physics state and updates entity transforms
 * and player controller states. Uses generation counter to avoid processing
 * the same snapshot multiple times.
 *
 * @param world - The ECS world to update
 * @param physCtx - Physics context containing shared buffers
 */
export function applyPhysicsSnapshot(
  world: World,
  physCtx: PhysicsContext,
): void {
  // Check if new snapshot is available
  const gen = Atomics.load(physCtx.statesI32, STATES_GEN_OFFSET >> 2);
  if (gen === state.lastSnapshotGen) return;
  state.lastSnapshotGen = gen;

  // Determine which slot to read from (triple buffering)
  const writeIdx = Atomics.load(
    physCtx.statesI32,
    STATES_WRITE_INDEX_OFFSET >> 2,
  );
  if (writeIdx < 0 || writeIdx >= STATES_SLOT_COUNT) return;

  const slotBaseI32 =
    (STATES_SLOT_OFFSET >> 2) + writeIdx * (STATES_SLOT_SIZE >> 2);
  const count = Atomics.load(physCtx.statesI32, slotBaseI32);
  if (count <= 0) return;

  // Build physics ID to entity mapping
  const physEntities = world.query([PhysicsBodyComponent]);
  const physToEntity = new Map<number, number>();
  for (const e of physEntities) {
    const bc = world.getComponent(e, PhysicsBodyComponent);
    if (bc?.physId) physToEntity.set(bc.physId, e);
  }

  // Apply snapshot data to entities
  for (let i = 0; i < count && i < STATES_MAX_BODIES; i++) {
    // Record layout: [u32 physId][f32 pos3][f32 rot4][f32 onGround] = 36 bytes
    const recordBaseI32 = slotBaseI32 + 1 + i * 9;
    const physId = Atomics.load(physCtx.statesI32, recordBaseI32);
    const entity = physToEntity.get(physId);
    if (!entity) continue;

    const payloadF32 = recordBaseI32 + 1;
    const px = physCtx.statesF32[payloadF32 + 0];
    const py = physCtx.statesF32[payloadF32 + 1];
    const pz = physCtx.statesF32[payloadF32 + 2];
    const rx = physCtx.statesF32[payloadF32 + 3];
    const ry = physCtx.statesF32[payloadF32 + 4];
    const rz = physCtx.statesF32[payloadF32 + 5];
    const rw = physCtx.statesF32[payloadF32 + 6];
    const onGround = physCtx.statesF32[payloadF32 + 7];

    // Update transform component
    const t = world.getComponent(entity, TransformComponent);
    if (t) {
      t.setPosition(px, py, pz);
      t.setRotation([rx, ry, rz, rw] as unknown as Float32Array);
      t.isDirty = true;
    }

    // Update player controller ground state
    const playerController = world.getComponent(
      entity,
      PlayerControllerComponent,
    );
    if (playerController) {
      playerController.onGround = onGround > 0.5;
    }
  }
}

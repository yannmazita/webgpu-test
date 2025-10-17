// src/app/physicsWorker/snapshot.ts
import { state } from "@/app/physicsWorker/state";
import {
  STATES_PHYSICS_STEP_TIME_MS_OFFSET,
  STATES_WRITE_INDEX_OFFSET,
  STATES_SLOT_OFFSET,
  STATES_SLOT_COUNT,
  STATES_SLOT_SIZE,
  STATES_MAX_BODIES,
  STATES_GEN_OFFSET,
  STATES_READ_GEN_OFFSET,
} from "@/core/sharedPhysicsLayout";

export function publishSnapshot(): void {
  if (!state.world || !state.statesI32 || !state.statesF32) {
    return;
  }

  state.statesF32[STATES_PHYSICS_STEP_TIME_MS_OFFSET >> 2] =
    state.lastStepTimeMs;

  const currIdx = Atomics.load(state.statesI32, STATES_WRITE_INDEX_OFFSET >> 2);
  const nextIdx = (currIdx + 1) % STATES_SLOT_COUNT;

  const slotBaseI32 =
    (STATES_SLOT_OFFSET >> 2) + nextIdx * (STATES_SLOT_SIZE >> 2);

  Atomics.store(state.statesI32, slotBaseI32, 0);

  let count = 0;
  state.world.bodies.forEach((body) => {
    if (count >= STATES_MAX_BODIES) {
      return;
    }

    const physId = state.bodyToEntity.get(body) ?? 0;
    if (physId === 0) {
      return;
    }

    const pos = body.translation();
    const rot = body.rotation();
    const onGround = state.playerOnGround.get(physId) ?? 0.0;

    const recordBaseI32 = slotBaseI32 + 1 + count * 9;

    Atomics.store(state.statesI32, recordBaseI32, physId);

    const payloadF32 = recordBaseI32 + 1;
    state.statesF32.set(
      [pos.x, pos.y, pos.z, rot.x, rot.y, rot.z, rot.w, onGround],
      payloadF32,
    );

    count++;
  });

  Atomics.store(state.statesI32, slotBaseI32, count);
  Atomics.store(state.statesI32, STATES_WRITE_INDEX_OFFSET >> 2, nextIdx);
  Atomics.add(state.statesI32, STATES_GEN_OFFSET >> 2, 1);
  Atomics.store(
    state.statesI32,
    STATES_READ_GEN_OFFSET >> 2,
    Atomics.load(state.statesI32, STATES_GEN_OFFSET >> 2),
  );
}

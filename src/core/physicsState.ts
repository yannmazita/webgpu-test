// src/core/physicsState.ts

/**
 * Physics SharedArrayBuffer context helpers.
 *
 * This module mirrors the style used by other shared-state helpers (metrics/engine state):
 * - Wraps SharedArrayBuffers into typed views
 * - Initializes headers (MAGIC/VERSION/indices)
 * - Provides a single-producer command enqueue helper for the render thread
 *
 * No Rapier or ECS dependencies. All sizes/offsets come from sharedPhysicsLayout.
 */

import {
  PHYSICS_MAGIC,
  PHYSICS_VERSION,
  // Commands layout
  COMMANDS_MAGIC_OFFSET,
  COMMANDS_VERSION_OFFSET,
  COMMANDS_HEAD_OFFSET,
  COMMANDS_TAIL_OFFSET,
  COMMANDS_GEN_OFFSET,
  COMMANDS_SLOT_OFFSET,
  COMMANDS_SLOT_SIZE,
  COMMANDS_RING_CAPACITY,
  COMMANDS_BUFFER_SIZE,
  // States layout
  STATES_MAGIC_OFFSET,
  STATES_VERSION_OFFSET,
  STATES_WRITE_INDEX_OFFSET,
  STATES_READ_GEN_OFFSET,
  STATES_GEN_OFFSET,
  STATES_BUFFER_SIZE,
} from "@/core/sharedPhysicsLayout";

/** Context holding typed-array views into the shared physics buffers. */
export interface PhysicsContext {
  /** Commands (render → physics) Int32 view. */
  commandsI32: Int32Array;
  /** Commands (render → physics) Float32 view (same buffer as commandsI32). */
  commandsF32: Float32Array;
  /** States (physics → render) Int32 view. */
  statesI32: Int32Array;
  /** States (physics → render) Float32 view (same buffer as statesI32). */
  statesF32: Float32Array;
}

/**
 * Converts a byte offset into a 32-bit element index for Int32/Float32 views.
 * @param byteOffset Byte offset within the buffer.
 * @returns 32-bit element index.
 */
const idx = (byteOffset: number) => byteOffset >> 2;

/**
 * Creates a physics context from the shared buffers.
 *
 * Behavior:
 * - Does not modify memory (no header writes). Use initializePhysicsHeaders on the writer.
 * - Throws if buffer sizes do not match expected layout sizes.
 *
 * @param commandsBuffer SharedArrayBuffer for commands (render → physics).
 * @param statesBuffer SharedArrayBuffer for states (physics → render).
 * @returns PhysicsContext with typed views for both buffers.
 * @throws If buffer sizes are invalid.
 */
export function createPhysicsContext(
  commandsBuffer: SharedArrayBuffer,
  statesBuffer: SharedArrayBuffer,
): PhysicsContext {
  if (commandsBuffer.byteLength !== COMMANDS_BUFFER_SIZE) {
    throw new Error(
      `createPhysicsContext: commandsBuffer has invalid size ${commandsBuffer.byteLength}, expected ${COMMANDS_BUFFER_SIZE}`,
    );
  }
  if (statesBuffer.byteLength !== STATES_BUFFER_SIZE) {
    throw new Error(
      `createPhysicsContext: statesBuffer has invalid size ${statesBuffer.byteLength}, expected ${STATES_BUFFER_SIZE}`,
    );
  }
  return {
    commandsI32: new Int32Array(commandsBuffer),
    commandsF32: new Float32Array(commandsBuffer),
    statesI32: new Int32Array(statesBuffer),
    statesF32: new Float32Array(statesBuffer),
  };
}

/**
 * Initializes the headers for the physics shared buffers (writer-side).
 *
 * Writes:
 * - Commands: MAGIC, VERSION, HEAD=0, TAIL=0, GEN=0
 * - States: MAGIC, VERSION, WRITE_INDEX=0, READ_GEN=0, GEN=0
 *
 * Safe to call multiple times; values are idempotent. Does not clear slots.
 *
 * @param ctx PhysicsContext wrapping the shared buffers.
 */
export function initializePhysicsHeaders(ctx: PhysicsContext): void {
  // Commands header
  Atomics.store(ctx.commandsI32, idx(COMMANDS_MAGIC_OFFSET), PHYSICS_MAGIC);
  Atomics.store(ctx.commandsI32, idx(COMMANDS_VERSION_OFFSET), PHYSICS_VERSION);
  Atomics.store(ctx.commandsI32, idx(COMMANDS_HEAD_OFFSET), 0);
  Atomics.store(ctx.commandsI32, idx(COMMANDS_TAIL_OFFSET), 0);
  Atomics.store(ctx.commandsI32, idx(COMMANDS_GEN_OFFSET), 0);

  // States header
  Atomics.store(ctx.statesI32, idx(STATES_MAGIC_OFFSET), PHYSICS_MAGIC);
  Atomics.store(ctx.statesI32, idx(STATES_VERSION_OFFSET), PHYSICS_VERSION);
  Atomics.store(ctx.statesI32, idx(STATES_WRITE_INDEX_OFFSET), 0);
  Atomics.store(ctx.statesI32, idx(STATES_READ_GEN_OFFSET), 0);
  Atomics.store(ctx.statesI32, idx(STATES_GEN_OFFSET), 0);
}

/**
 * Resets the commands ring indices (HEAD=TAIL=0) and bumps GEN.
 *
 * Useful for tests or hard reset scenarios. No-ops if buffer not shared.
 *
 * @param ctx PhysicsContext wrapping the shared buffers.
 */
export function resetCommands(ctx: PhysicsContext): void {
  Atomics.store(ctx.commandsI32, idx(COMMANDS_HEAD_OFFSET), 0);
  Atomics.store(ctx.commandsI32, idx(COMMANDS_TAIL_OFFSET), 0);
  Atomics.add(ctx.commandsI32, idx(COMMANDS_GEN_OFFSET), 1);
}

/**
 * Attempts to enqueue a command into the ring buffer (single producer).
 *
 * Lock-free SPSC pattern:
 * - Reads HEAD/TAIL (u32)
 * - Checks full condition: next(HEAD) == TAIL
 * - Writes TYPE/PHYS_ID (Atomics.store) and PARAMS (Float32 set)
 * - Publishes by advancing HEAD (Atomics.store) and bumps GEN
 *
 * PARAMS handling:
 * - Up to 12 floats; extra values are ignored, missing values are zero-padded.
 * - Leave unspecified PARAMS as 0 for unused commands (e.g., DESTROY_BODY).
 *
 * @param ctx PhysicsContext (commands views required).
 * @param type Command type (CMD_*).
 * @param physId Physics body ID (u32).
 * @param params Optional parameter block (up to 12 numbers).
 * @returns True if enqueued, false if the ring is full (command dropped).
 */
export function tryEnqueueCommand(
  ctx: PhysicsContext,
  type: number,
  physId: number,
  params?: readonly number[],
): boolean {
  const head = Atomics.load(ctx.commandsI32, idx(COMMANDS_HEAD_OFFSET));
  const tail = Atomics.load(ctx.commandsI32, idx(COMMANDS_TAIL_OFFSET));
  const next = (head + 1) % COMMANDS_RING_CAPACITY;
  if (next === tail) {
    // Ring full; drop command
    return false;
  }

  const slotByteOffset = COMMANDS_SLOT_OFFSET + head * COMMANDS_SLOT_SIZE;
  const slotI32 = idx(slotByteOffset);
  const slotF32 = idx(slotByteOffset + 8); // After TYPE(u32) + PHYS_ID(u32) = 8 bytes

  // Write header (TYPE, PHYS_ID)
  Atomics.store(ctx.commandsI32, slotI32 + 0, type | 0);
  Atomics.store(ctx.commandsI32, slotI32 + 1, physId | 0);

  // Write PARAMS (up to 12 floats)
  const p = params ?? [];
  const count = Math.min(12, p.length);
  for (let i = 0; i < count; i++) {
    ctx.commandsF32[slotF32 + i] = p[i];
  }
  // Zero-pad remaining
  for (let i = count; i < 12; i++) {
    ctx.commandsF32[slotF32 + i] = 0.0;
  }

  // Publish: advance HEAD and bump GEN
  Atomics.store(ctx.commandsI32, idx(COMMANDS_HEAD_OFFSET), next);
  Atomics.add(ctx.commandsI32, idx(COMMANDS_GEN_OFFSET), 1);
  return true;
}

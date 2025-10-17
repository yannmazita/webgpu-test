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
  COMMANDS_MAX_PARAMS_F32,
  // States layout
  STATES_MAGIC_OFFSET,
  STATES_VERSION_OFFSET,
  STATES_WRITE_INDEX_OFFSET,
  STATES_READ_GEN_OFFSET,
  STATES_GEN_OFFSET,
  STATES_BUFFER_SIZE,
  COLLISION_EVENTS_BUFFER_SIZE,
  COLLISION_EVENTS_MAGIC,
  COLLISION_EVENTS_VERSION,
  COLLISION_EVENTS_MAGIC_OFFSET,
  COLLISION_EVENTS_VERSION_OFFSET,
  COLLISION_EVENTS_HEAD_OFFSET,
  COLLISION_EVENTS_TAIL_OFFSET,
  COLLISION_EVENTS_GEN_OFFSET,
  CHAR_CONTROLLER_EVENTS_BUFFER_SIZE,
  CHAR_CONTROLLER_EVENTS_MAGIC_OFFSET,
  CHAR_CONTROLLER_EVENTS_VERSION,
  CHAR_CONTROLLER_EVENTS_MAGIC,
  CHAR_CONTROLLER_EVENTS_VERSION_OFFSET,
  CHAR_CONTROLLER_EVENTS_HEAD_OFFSET,
  CHAR_CONTROLLER_EVENTS_TAIL_OFFSET,
  CHAR_CONTROLLER_EVENTS_GEN_OFFSET,
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
  /** Collision Events (physics → render) Int32 view. */
  collisionEventsI32: Int32Array;
  /** Character Controller Events (physics → render) Int32 view. */
  charControllerEventsI32: Int32Array;
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
 * @remarks
 * This function validates that the byte length of each provided buffer matches
 * the expected size defined in the shared layout. It does not modify memory;
 * headers must be initialized separately by the writer.
 *
 * @param commandsBuffer - SharedArrayBuffer for commands (render → physics).
 * @param statesBuffer - SharedArrayBuffer for states (physics → render).
 * @param collisionEventsBuffer - SharedArrayBuffer for collision events (physics → render).
 * @param charControllerEventsBuffer - SharedArrayBuffer for character controller events (physics → render).
 * @returns PhysicsContext with typed views for all buffers.
 * @throws If any buffer has an invalid size.
 */
export function createPhysicsContext(
  commandsBuffer: SharedArrayBuffer,
  statesBuffer: SharedArrayBuffer,
  collisionEventsBuffer: SharedArrayBuffer,
  charControllerEventsBuffer: SharedArrayBuffer,
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
  if (collisionEventsBuffer.byteLength !== COLLISION_EVENTS_BUFFER_SIZE) {
    throw new Error(
      `createPhysicsContext: collisionEventsBuffer has invalid size ${collisionEventsBuffer.byteLength}, expected ${COLLISION_EVENTS_BUFFER_SIZE}`,
    );
  }
  if (
    charControllerEventsBuffer.byteLength !== CHAR_CONTROLLER_EVENTS_BUFFER_SIZE
  ) {
    throw new Error(
      `createPhysicsContext: charControllerEventsBuffer has invalid size ${charControllerEventsBuffer.byteLength}, expected ${CHAR_CONTROLLER_EVENTS_BUFFER_SIZE}`,
    );
  }
  return {
    commandsI32: new Int32Array(commandsBuffer),
    commandsF32: new Float32Array(commandsBuffer),
    statesI32: new Int32Array(statesBuffer),
    statesF32: new Float32Array(statesBuffer),
    collisionEventsI32: new Int32Array(collisionEventsBuffer),
    charControllerEventsI32: new Int32Array(charControllerEventsBuffer),
  };
}

/**
 * Initializes the headers for the physics shared buffers (writer-side).
 *
 * @remarks
 * This function writes the MAGIC and VERSION numbers to the commands, states,
 * and collision event buffers. It also resets all ring buffer indices (head,
 * tail) and generation counters to zero. It is safe to call multiple times.
 *
 * @param ctx - PhysicsContext wrapping the shared buffers.
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

  // Collision Events header
  Atomics.store(
    ctx.collisionEventsI32,
    idx(COLLISION_EVENTS_MAGIC_OFFSET),
    COLLISION_EVENTS_MAGIC,
  );
  Atomics.store(
    ctx.collisionEventsI32,
    idx(COLLISION_EVENTS_VERSION_OFFSET),
    COLLISION_EVENTS_VERSION,
  );
  Atomics.store(ctx.collisionEventsI32, idx(COLLISION_EVENTS_HEAD_OFFSET), 0);
  Atomics.store(ctx.collisionEventsI32, idx(COLLISION_EVENTS_TAIL_OFFSET), 0);
  Atomics.store(ctx.collisionEventsI32, idx(COLLISION_EVENTS_GEN_OFFSET), 0);

  // Character Controller Events header
  Atomics.store(
    ctx.charControllerEventsI32,
    idx(CHAR_CONTROLLER_EVENTS_MAGIC_OFFSET),
    CHAR_CONTROLLER_EVENTS_MAGIC,
  );
  Atomics.store(
    ctx.charControllerEventsI32,
    idx(CHAR_CONTROLLER_EVENTS_VERSION_OFFSET),
    CHAR_CONTROLLER_EVENTS_VERSION,
  );
  Atomics.store(
    ctx.charControllerEventsI32,
    idx(CHAR_CONTROLLER_EVENTS_HEAD_OFFSET),
    0,
  );
  Atomics.store(
    ctx.charControllerEventsI32,
    idx(CHAR_CONTROLLER_EVENTS_TAIL_OFFSET),
    0,
  );
  Atomics.store(
    ctx.charControllerEventsI32,
    idx(CHAR_CONTROLLER_EVENTS_GEN_OFFSET),
    0,
  );
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
 * Attempts to enqueue a command into the shared physics command ring buffer.
 *
 * This function implements the producer side of a single-producer/single-consumer
 * (SPSC) queue. It is designed to be called from the render worker to send
 * commands to the physics worker in a lock-free manner.
 *
 * The enqueue process is:
 * 1. Atomically load the current `head` (producer) and `tail` (consumer) indices.
 * 2. Check if the buffer is full. The buffer is full if the next write position
 *    (`head + 1`) would collide with the current read position (`tail`). If so,
 *    the command is dropped and the function returns `false`.
 * 3. If space is available, the command `type`, `physId`, and `params` are
 *    written to the slot indicated by the `head` index.
 * 4. The `head` index is atomically advanced, making the command visible to the
 *    consumer (the physics worker).
 * 5. A generation counter is incremented for observability.
 *
 * @param ctx The physics context containing the shared
 *     command buffer views.
 * @param type The integer type of the command (e.g., `CMD_CREATE_BODY`).
 * @param physId The unique physics ID of the target entity.
 * @param params An optional array of floating-point
 *     parameters for the command. The array will be truncated or zero-padded to
 *     fit the command slot's parameter block size.
 * @return `true` if the command was successfully enqueued, `false` if
 *     the command ring was full and the command was dropped.
 */
export function tryEnqueueCommand(
  ctx: PhysicsContext,
  type: number,
  physId: number,
  params?: readonly number[],
): boolean {
  // --- SPSC Ring Buffer Full Check ---
  // Atomically load the current head and tail indices to check for space.
  const head = Atomics.load(ctx.commandsI32, idx(COMMANDS_HEAD_OFFSET));
  const tail = Atomics.load(ctx.commandsI32, idx(COMMANDS_TAIL_OFFSET));

  // Calculate the next head position, wrapping around the buffer capacity.
  const next = (head + 1) % COMMANDS_RING_CAPACITY;

  // If the next write position is the same as the current read position, the
  // buffer is full. Drop the command to prevent overwriting unread data.
  if (next === tail) {
    console.warn(
      "[tryEnqueueCommand] Command ring buffer is full. Command dropped.",
    );
    return false;
  }

  // --- Write Command to Slot ---
  // Calculate the memory offset for the slot at the current head index.
  const slotByteOffset = COMMANDS_SLOT_OFFSET + head * COMMANDS_SLOT_SIZE;
  const slotI32 = idx(slotByteOffset);
  // The float parameters start 8 bytes after the slot's beginning (after type and id).
  const slotF32 = idx(slotByteOffset + 8);

  // Write the command header (type and ID) using atomic stores.
  Atomics.store(ctx.commandsI32, slotI32 + 0, type | 0);
  Atomics.store(ctx.commandsI32, slotI32 + 1, physId | 0);

  // Write the floating-point parameter block.
  const p = params ?? [];
  const count = Math.min(COMMANDS_MAX_PARAMS_F32, p.length);
  for (let i = 0; i < count; i++) {
    ctx.commandsF32[slotF32 + i] = p[i];
  }
  // Zero-pad any remaining space in the parameter block for data consistency.
  for (let i = count; i < COMMANDS_MAX_PARAMS_F32; i++) {
    ctx.commandsF32[slotF32 + i] = 0.0;
  }

  // --- Publish Command ---
  // The following atomic operations make the command visible to the consumer.
  // 1. Atomically advance the head index to the next available slot. This is
  //    the "commit" that publishes the command.
  Atomics.store(ctx.commandsI32, idx(COMMANDS_HEAD_OFFSET), next);

  // 2. Increment the generation counter for observability and debugging.
  Atomics.add(ctx.commandsI32, idx(COMMANDS_GEN_OFFSET), 1);

  return true;
}

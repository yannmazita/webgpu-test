// src/app/physicsWorker.ts
/// <reference lib="webworker" />

import * as RAPIER from "@dimforge/rapier3d-simd";
import {
  PhysicsInitMsg,
  PhysicsStepMsg,
  PhysicsDestroyMsg,
  PhysicsReadyMsg,
  PhysicsStepDoneMsg,
  PhysicsDestroyedMsg,
} from "@/core/types/physics";
import {
  PHYSICS_MAGIC,
  PHYSICS_VERSION,
  COMMANDS_MAGIC_OFFSET,
  COMMANDS_VERSION_OFFSET,
  STATES_MAGIC_OFFSET,
  STATES_VERSION_OFFSET,
  COMMANDS_BUFFER_SIZE,
  STATES_BUFFER_SIZE,
  COMMANDS_RING_CAPACITY,
  COMMANDS_SLOT_OFFSET,
  COMMANDS_HEAD_OFFSET,
  COMMANDS_TAIL_OFFSET,
  COMMANDS_GEN_OFFSET,
  STATES_SLOT_OFFSET,
  STATES_WRITE_INDEX_OFFSET,
  STATES_GEN_OFFSET,
  STATES_MAX_BODIES,
  CMD_CREATE_BODY,
  COMMANDS_SLOT_SIZE,
  STATES_SLOT_COUNT,
  STATES_SLOT_SIZE,
} from "@/core/sharedPhysicsLayout";

/**
 * Physics worker: Initializes Rapier, processes commands from ring buffer,
 * steps world at fixed 60Hz, publishes snapshots to triple-buffered states SAB.
 *
 * No interpolation/camera collisions. Dummy test on init: ground + falling sphere.
 * Logs positions; drops commands on overflow.
 *
 * Fixed timestep: 1/60s with accumulator for stability.
 */

/**
 * Validates a SAB header (magic/version).
 * @param view Int32Array view of SAB.
 * @param magicOffset Expected magic offset.
 * @param versionOffset Expected version offset.
 * @param expectedMagic Expected magic.
 * @param expectedVersion Expected version.
 * @returns True if valid.
 */
function validateHeader(
  view: Int32Array,
  magicOffset: number,
  versionOffset: number,
  expectedMagic: number,
  expectedVersion: number,
): boolean {
  return (
    Atomics.load(view, magicOffset >> 2) === expectedMagic &&
    Atomics.load(view, versionOffset >> 2) === expectedVersion
  );
}

/**
 * Advances read tail after consuming command (atomic add).
 * @param view Int32Array for tail.
 */
function commandsAdvanceReadTail(view: Int32Array): void {
  let tail = Atomics.load(view, COMMANDS_TAIL_OFFSET >> 2);
  tail = (tail + 1) % COMMANDS_RING_CAPACITY;
  Atomics.store(view, COMMANDS_TAIL_OFFSET >> 2, tail);
}

/**
 * Gets next state write slot (round-robin 0-2).
 * @param view Int32Array for write index.
 * @returns Current slot (0-2).
 */
function statesNextWriteSlot(view: Int32Array): number {
  let idx = Atomics.load(view, STATES_WRITE_INDEX_OFFSET >> 2);
  idx = (idx + 1) % STATES_SLOT_COUNT;
  Atomics.store(view, STATES_WRITE_INDEX_OFFSET >> 2, idx);
  return idx;
}

// --- Main Worker Logic ---

let rapier: typeof RAPIER;
let world: RAPIER.World | null = null;
let commandsView: Int32Array | null = null;
let statesI32: Int32Array | null = null;
let statesF32: Float32Array | null = null;
let stepInterval: NodeJS.Timeout | null = null;
const entityToBody = new Map<number, number>(); // PHYS_ID (u32) → Rapier body handle
let nextPhysId = 0; // Auto-increment PHYS_ID (mirrors ECS later)
let accumulator = 0;
const FIXED_DT = 1 / 60; // 16.666ms
const GRAVITY = { x: 0.0, y: -9.81, z: 0.0 };

/**
 * Initializes Rapier WASM and world.
 */
async function initRapier(): Promise<void> {
  await RAPIER.init();
  rapier = RAPIER;
  world = new rapier.World(GRAVITY);
  console.log("[PhysicsWorker] Rapier initialized. World gravity:", GRAVITY);
}

/**
 * Drains commands from ring buffer and applies them.
 * Currently supports dummy CREATE_BODY (type=1); ignores others.
 */
function processCommands(): void {
  if (!commandsView || !world) return;

  let tail = Atomics.load(commandsView, COMMANDS_TAIL_OFFSET >> 2);
  let head = Atomics.load(commandsView, COMMANDS_HEAD_OFFSET >> 2);
  const slotBase = COMMANDS_SLOT_OFFSET >> 2;

  while (tail !== head) {
    const slotIdx = (tail % COMMANDS_RING_CAPACITY) * (COMMANDS_SLOT_SIZE >> 2);
    const type = Atomics.load(commandsView, slotBase + slotIdx + 0);
    const physId = Atomics.load(commandsView, slotBase + slotIdx + 1);

    if (type === CMD_CREATE_BODY && physId === 0) {
      // Dummy create (no entity yet)
      // Dummy: Create ground (static box) if not exists
      if (entityToBody.size === 0) {
        const groundHandle = world.createCollider(
          rapier.ColliderDesc.cuboid(5.0, 0.1, 5.0).setTranslation(0, -0.1, 0),
        );
        entityToBody.set(0, groundHandle); // PHYS_ID 0 = ground
        nextPhysId = 1;
        console.log("[PhysicsWorker] Created dummy ground.");
      }

      // Create falling sphere (dynamic)
      const sphereHandle = world.createRigidBody(
        rapier.RigidBodyDesc.dynamic().setTranslation(0, 5, 0),
      );
      world.createCollider(
        rapier.ColliderDesc.ball(0.5).setTranslation(0, 5, 0),
        sphereHandle,
      );
      const sphereId = nextPhysId++;
      entityToBody.set(sphereId, sphereHandle.handle);
      console.log(`[PhysicsWorker] Created dummy sphere (ID=${sphereId}).`);
    } else if (type === CMD_DESTROY_BODY) {
      const body = entityToBody.get(physId);
      if (body !== undefined && world) {
        world.removeRigidBody(body, true);
        entityToBody.delete(physId);
        console.log(`[PhysicsWorker] Destroyed body ID=${physId}.`);
      }
    }
    // todo: Handle SET_TRANSFORM, SET_GRAVITY, etc.

    commandsAdvanceReadTail(commandsView);
    tail = Atomics.load(commandsView, COMMANDS_TAIL_OFFSET >> 2);
    head = Atomics.load(commandsView, COMMANDS_HEAD_OFFSET >> 2);
  }

  // Bump gen on changes
  if (tail !== head) {
    Atomics.add(commandsView, COMMANDS_GEN_OFFSET >> 2, 1);
  }
}

/**
 * Steps the physics world (fixed timestep with accumulator).
 * @param dt Real delta time (s).
 */
function stepWorld(dt: number): void {
  if (!world) return;

  accumulator += dt;
  while (accumulator >= FIXED_DT) {
    processCommands(); // Drain before step
    world.step(FIXED_DT);
    accumulator -= FIXED_DT;
  }

  // Log dummy sphere position every 60 steps (1s)
  if (entityToBody.size > 0 && (world.timestep / FIXED_DT) % 60 === 0) {
    const sphereBody = world.bodies.get(entityToBody.get(1)!); // ID=1
    if (sphereBody) {
      const pos = sphereBody.translation();
      console.log(
        `[PhysicsWorker] Sphere at [${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}]`,
      );
    }
  }
}

/**
 * Publishes current world snapshot to next state slot.
 * Writes body count + per-body (ID + pos3 + rot4).
 * Updates WRITE_INDEX/GEN atomically.
 */
function publishSnapshot(): void {
  if (!world || !statesI32 || !statesF32) return;

  const slotIdx = statesNextWriteSlot(statesI32);
  const slotBaseI32 =
    (STATES_SLOT_OFFSET >> 2) + slotIdx * (STATES_SLOT_SIZE >> 2);
  const slotBaseF32 = STATES_SLOT_OFFSET + slotIdx * STATES_SLOT_SIZE; // Byte offset for f32

  // Clear slot: count=0
  Atomics.store(statesI32, slotBaseI32, 0);

  let count = 0;
  world.bodies.forEach((body) => {
    if (count >= STATES_MAX_BODIES) {
      console.warn("[PhysicsWorker] Snapshot overflow; truncating.");
      return;
    }

    const physId =
      [...entityToBody.entries()].find(([, h]) => h === body.handle)?.[0] ?? 0;
    const pos = body.translation();
    const rot = body.rotation();

    // Write to slot: ID (i32 at offset 4*count + 4) + pos/rot (f32[7] after)
    const bodyOffsetI32 = slotBaseI32 + 1 + count * 8; // 8 u32 equiv per body (id + 7 f32)
    Atomics.store(statesI32, bodyOffsetI32, physId);

    const bodyOffsetF32 = (slotBaseF32 + 4 + count * 32) >> 2; // After count/ID, 32B/body
    statesF32.set(
      [pos.x, pos.y, pos.z, rot.x, rot.y, rot.z, rot.w],
      bodyOffsetF32,
    );

    count++;
  });

  // Update count and gen
  Atomics.store(statesI32, slotBaseI32, count);
  Atomics.add(statesI32, STATES_GEN_OFFSET >> 2, 1);
  Atomics.store(
    statesI32,
    STATES_READ_GEN_OFFSET >> 2,
    Atomics.load(statesI32, STATES_GEN_OFFSET >> 2),
  );

  if (count > 0) {
    console.log(
      `[PhysicsWorker] Published snapshot to slot ${slotIdx}: ${count} bodies`,
    );
  }
}

/**
 * Fixed-step loop (60Hz).
 */
function startPhysicsLoop(): void {
  let lastTime = performance.now();
  stepInterval = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    stepWorld(dt);
    publishSnapshot();
  }, 1000 / 60); // ~16.666ms
  console.log("[PhysicsWorker] Fixed-step loop started (60Hz).");
}

/**
 * Stops the physics loop and cleans up.
 */
function stopPhysicsLoop(): void {
  if (stepInterval) {
    clearInterval(stepInterval);
    stepInterval = null;
  }
  if (world) {
    world.free();
    world = null;
  }
  entityToBody.clear();
  nextPhysId = 0;
  console.log("[PhysicsWorker] Loop stopped and resources freed.");
}

// Message handler
self.onmessage = async (
  ev: MessageEvent<PhysicsInitMsg | PhysicsStepMsg | PhysicsDestroyMsg>,
) => {
  const msg = ev.data;

  if (msg.type === "INIT") {
    try {
      // Init Rapier
      await initRapier();

      // Validate/setup commands SAB
      if (msg.commandsBuffer.byteLength !== COMMANDS_BUFFER_SIZE) {
        throw new Error(
          `Invalid commands buffer size: ${msg.commandsBuffer.byteLength}`,
        );
      }
      commandsView = new Int32Array(msg.commandsBuffer);
      if (
        !validateHeader(
          commandsView,
          COMMANDS_MAGIC_OFFSET,
          COMMANDS_VERSION_OFFSET,
          PHYSICS_MAGIC,
          PHYSICS_VERSION,
        )
      ) {
        Atomics.store(commandsView, COMMANDS_MAGIC_OFFSET >> 2, PHYSICS_MAGIC);
        Atomics.store(
          commandsView,
          COMMANDS_VERSION_OFFSET >> 2,
          PHYSICS_VERSION,
        );
        Atomics.store(commandsView, COMMANDS_HEAD_OFFSET >> 2, 0);
        Atomics.store(commandsView, COMMANDS_TAIL_OFFSET >> 2, 0);
        Atomics.store(commandsView, COMMANDS_GEN_OFFSET >> 2, 0);
      }

      // Validate/setup states SAB
      if (msg.statesBuffer.byteLength !== STATES_BUFFER_SIZE) {
        throw new Error(
          `Invalid states buffer size: ${msg.statesBuffer.byteLength}`,
        );
      }
      statesI32 = new Int32Array(msg.statesBuffer);
      statesF32 = new Float32Array(msg.statesBuffer);
      if (
        !validateHeader(
          statesI32,
          STATES_MAGIC_OFFSET,
          STATES_VERSION_OFFSET,
          PHYSICS_MAGIC,
          PHYSICS_VERSION,
        )
      ) {
        Atomics.store(statesI32, STATES_MAGIC_OFFSET >> 2, PHYSICS_MAGIC);
        Atomics.store(statesI32, STATES_VERSION_OFFSET >> 2, PHYSICS_VERSION);
        Atomics.store(statesI32, STATES_WRITE_INDEX_OFFSET >> 2, 0);
        Atomics.store(statesI32, STATES_READ_GEN_OFFSET >> 2, 0);
        Atomics.store(statesI32, STATES_GEN_OFFSET >> 2, 0);
      }

      // Start loop
      startPhysicsLoop();

      // Dummy test: Commands will create on first process (tail != head)
      postMessage({ type: "READY" } as PhysicsReadyMsg);
      console.log("[PhysicsWorker] Initialized successfully.");
    } catch (e) {
      console.error("[PhysicsWorker] Init failed:", e);
      postMessage({ type: "ERROR" as const, error: (e as Error).message });
    }
    return;
  }

  if (!world) {
    console.warn("[PhysicsWorker] Ignoring message: World not initialized.");
    return;
  }

  switch (msg.type) {
    case "STEP":
      const steps = msg.steps ?? 1;
      for (let i = 0; i < steps; i++) {
        const dt = 1 / 60; // Fixed
        stepWorld(dt);
        publishSnapshot();
      }
      postMessage({
        type: "STEP_DONE",
        steps,
        log: "Dummy steps complete.",
      } as PhysicsStepDoneMsg);
      break;

    case "DESTROY":
      stopPhysicsLoop();
      postMessage({ type: "DESTROYED" } as PhysicsDestroyedMsg);
      break;

    default:
      console.warn("[PhysicsWorker] Unknown message:", msg.type);
  }
};

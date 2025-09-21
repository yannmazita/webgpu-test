// src/app/physicsWorker.ts
/// <reference lib="webworker" />

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
  STATES_READ_GEN_OFFSET,
} from "@/core/sharedPhysicsLayout";

// Type imports from Rapier (guide: maintain type safety)
type RAPIER = typeof import("@dimforge/rapier3d");
type World = import("@dimforge/rapier3d").World;
type RigidBodyDesc = import("@dimforge/rapier3d").RigidBodyDesc;
type RigidBody = import("@dimforge/rapier3d").RigidBody;
type ColliderDesc = import("@dimforge/rapier3d").ColliderDesc;
type IntegrationParameters = import("@dimforge/rapier3d").IntegrationParameters;

/**
 * Physics worker: Initializes Rapier, processes commands from ring buffer,
 * steps world at fixed 60Hz, publishes snapshots to triple-buffered states SAB.
 *
 * No interpolation/camera collisions. Dummy test on init: ground + falling sphere.
 * Logs positions; drops commands on overflow.
 *
 * Fixed timestep: 1/60s with accumulator for stability.
 */

let RAPIER: RAPIER | null = null;
let world: World | null = null;
let commandsView: Int32Array | null = null;
let statesI32: Int32Array | null = null;
let statesF32: Float32Array | null = null;
let stepInterval: number | null = null; // setInterval in workers returns number
const entityToBody = new Map<number, RigidBody>(); // PHYS_ID → RigidBody
const bodyToEntity = new WeakMap<RigidBody, number>(); // RigidBody → PHYS_ID
let nextPhysId = 0; // Auto-increment PHYS_ID (mirrors ECS later)
let accumulator = 0;
const FIXED_DT = 1 / 60; // 16.666ms
const GRAVITY = { x: 0.0, y: -9.81, z: 0.0 };
let isInitialized = false;

let rapierPromise: Promise<void> | null = null;

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

/**
 * Initializes Rapier WASM and world.
 * Logs load time and detailed errors. Sets fixed dt via integrationParameters.
 */
async function initRapier(): Promise<void> {
  if (rapierPromise) return rapierPromise;

  console.log("Starting Rapier initialization..."); // Guide debugging

  rapierPromise = new Promise(async (resolve, reject) => {
    try {
      const start = performance.now(); // Guide perf logging

      // Dynamic import (guide: handles WASM automatically; no separate init() in recent versions)
      RAPIER = await import("@dimforge/rapier3d");
      const loadTime = performance.now() - start;

      console.log(`Rapier loaded in ${loadTime.toFixed(2)}ms`); // Guide logging

      // Create physics world (no module.init() needed)
      world = new RAPIER.World(GRAVITY);
      console.log("Physics world created successfully"); // Guide success log

      // Set fixed timestep (docs: via integrationParameters; step() uses this without args)
      const params: IntegrationParameters = world.integrationParameters;
      params.dt = FIXED_DT;
      console.log(
        "[PhysicsWorker] Rapier initialized successfully. World gravity:",
        GRAVITY,
        `Fixed dt: ${FIXED_DT}`,
      );

      isInitialized = true;
      resolve();
    } catch (error) {
      console.error("Physics initialization failed:", error); // Guide error
      console.error("Error stack:", error.stack); // Guide detailed stack
      RAPIER = null;
      world = null;
      isInitialized = false;
      resolve(); // Continue without physics (worker alive for messages)
    }
  });

  return rapierPromise;
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
      if (entityToBody.size === 0) {
        const groundBodyDesc: RigidBodyDesc =
          RAPIER!.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0);
        const groundBody: RigidBody = world!.createRigidBody(groundBodyDesc);
        const groundColliderDesc: ColliderDesc = RAPIER!.ColliderDesc.cuboid(
          5.0,
          0.1,
          5.0,
        );
        world!.createCollider(groundColliderDesc, groundBody);

        const groundId = nextPhysId++;
        entityToBody.set(groundId, groundBody);
        bodyToEntity.set(groundBody, groundId);
        console.log(`[PhysicsWorker] Created dummy ground (ID=${groundId}).`);
      }

      const sphereBodyDesc: RigidBodyDesc =
        RAPIER!.RigidBodyDesc.dynamic().setTranslation(0, 5, 0);
      const sphereBody: RigidBody = world!.createRigidBody(sphereBodyDesc);
      const sphereColliderDesc: ColliderDesc = RAPIER!.ColliderDesc.ball(0.5);
      world!.createCollider(sphereColliderDesc, sphereBody);

      const sphereId = nextPhysId++;
      entityToBody.set(sphereId, sphereBody);
      bodyToEntity.set(sphereBody, sphereId);
      console.log(`[PhysicsWorker] Created dummy sphere (ID=${sphereId}).`);
    } else if (type === 2) {
      // CMD_DESTROY_BODY
      const body = entityToBody.get(physId);
      if (body && world) {
        world.removeRigidBody(body, true);
        entityToBody.delete(physId);
        // WeakMap auto-cleans; no delete needed for bodyToEntity
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
    try {
      Atomics.add(commandsView, COMMANDS_GEN_OFFSET >> 2, 1);
    } catch (e) {
      console.warn("[PhysicsWorker] Failed to bump commands GEN:", e);
    }
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
    world.step(); // No args: uses integrationParameters.dt (docs)
    accumulator -= FIXED_DT;
  }

  // Log dummy sphere position every 60 steps (1s)
  if (
    entityToBody.size > 1 &&
    Math.floor(world.timestep / FIXED_DT) % 60 === 0
  ) {
    const sphere = entityToBody.get(1); // demo sphere has ID=1
    if (sphere) {
      const pos = sphere.translation();
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
  const slotBaseF32Byte = STATES_SLOT_OFFSET + slotIdx * STATES_SLOT_SIZE;

  // Clear slot: count=0 (at offset 0)
  try {
    Atomics.store(statesI32, slotBaseI32, 0);
  } catch (e) {
    console.warn("[PhysicsWorker] Failed to clear snapshot slot:", e);
    return;
  }

  let count = 0;
  world.bodies.forEach((body: RigidBody) => {
    if (count >= STATES_MAX_BODIES) {
      console.warn("[PhysicsWorker] Snapshot overflow; truncating.");
      return;
    }

    const physId = bodyToEntity.get(body) ?? 0;
    const pos = body.translation();
    const rot = body.rotation();

    // ID is at: slotBaseI32 + 1 + count * 8 (since 32 bytes/body = 8 Int32s)
    const bodyOffsetI32 = slotBaseI32 + 1 + count * 8;
    Atomics.store(statesI32, bodyOffsetI32, physId);

    // f32 payload starts after count(4B)+id(4B): byte offset = slotBaseF32Byte + 8 + count * 32
    const bodyOffsetF32 = (slotBaseF32Byte + 8 + count * 32) >> 2;
    statesF32.set(
      [pos.x, pos.y, pos.z, rot.x, rot.y, rot.z, rot.w],
      bodyOffsetF32,
    );

    count++;
  });

  // Update count and gen
  Atomics.store(statesI32, slotBaseI32, count);
  try {
    Atomics.add(statesI32, STATES_GEN_OFFSET >> 2, 1);
    Atomics.store(
      statesI32,
      STATES_READ_GEN_OFFSET >> 2,
      Atomics.load(statesI32, STATES_GEN_OFFSET >> 2),
    );
  } catch (e) {
    console.warn("[PhysicsWorker] Failed to update snapshot GEN:", e);
  }

  if (count > 0) {
    /*
    console.log(
      `[PhysicsWorker] Published snapshot to slot ${slotIdx}: ${count} bodies`,
    );
    */
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
    entityToBody.forEach((body) => {
      world!.removeRigidBody(body);
    });
    world.free();
    world = null;
  }
  entityToBody.clear();
  nextPhysId = 0;
  accumulator = 0;
  isInitialized = false;
  console.log("[PhysicsWorker] Loop stopped and resources freed.");
}

// Message handler
self.onmessage = async (
  ev: MessageEvent<PhysicsInitMsg | PhysicsStepMsg | PhysicsDestroyMsg>,
) => {
  const msg = ev.data;

  if (msg.type === "INIT") {
    try {
      // Init Rapier (lazy async)
      await initRapier();
      if (!isInitialized || !RAPIER || !world) {
        throw new Error("Rapier init failed; no world available.");
      }

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

  if (!world || !isInitialized) {
    console.warn("[PhysicsWorker] Ignoring message: World not initialized.");
    return;
  }

  switch (msg.type) {
    case "STEP": {
      const steps = msg.steps ?? 1;
      for (let i = 0; i < steps; i++) {
        const dt = FIXED_DT;
        stepWorld(dt);
        publishSnapshot();
      }
      postMessage({
        type: "STEP_DONE",
        steps,
        log: "Dummy steps complete.",
      } as PhysicsStepDoneMsg);
      break;
    }

    case "DESTROY":
      stopPhysicsLoop();
      postMessage({ type: "DESTROYED" } as PhysicsDestroyedMsg);
      break;

    default:
      console.warn("[PhysicsWorker] Unknown message:", msg.type);
  }
};

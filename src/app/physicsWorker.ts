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
  // Commands SAB
  COMMANDS_MAGIC_OFFSET,
  COMMANDS_VERSION_OFFSET,
  COMMANDS_BUFFER_SIZE,
  COMMANDS_RING_CAPACITY,
  COMMANDS_SLOT_OFFSET,
  COMMANDS_SLOT_SIZE,
  COMMANDS_HEAD_OFFSET,
  COMMANDS_TAIL_OFFSET,
  COMMANDS_GEN_OFFSET,
  // States SAB
  STATES_MAGIC_OFFSET,
  STATES_VERSION_OFFSET,
  STATES_BUFFER_SIZE,
  STATES_SLOT_COUNT,
  STATES_SLOT_OFFSET,
  STATES_SLOT_SIZE,
  STATES_MAX_BODIES,
  STATES_WRITE_INDEX_OFFSET,
  STATES_GEN_OFFSET,
  STATES_READ_GEN_OFFSET,
  // Command types
  CMD_CREATE_BODY,
  CMD_DESTROY_BODY,
  STATES_PHYSICS_STEP_TIME_MS_OFFSET,
} from "@/core/sharedPhysicsLayout";

// Type imports from Rapier
type RAPIER = typeof import("@dimforge/rapier3d");
type World = import("@dimforge/rapier3d").World;
type RigidBodyDesc = import("@dimforge/rapier3d").RigidBodyDesc;
type RigidBody = import("@dimforge/rapier3d").RigidBody;
type ColliderDesc = import("@dimforge/rapier3d").ColliderDesc;
type IntegrationParameters = import("@dimforge/rapier3d").IntegrationParameters;

/**
 * Physics worker:
 * - Initializes Rapier in a Web Worker
 * - Processes commands from a ring buffer (SAB)
 * - Steps world at fixed 60Hz with an accumulator
 * - Publishes snapshots to a triple-buffered states SAB
 */

let RAPIER: RAPIER | null = null;
let world: World | null = null;

let commandsView: Int32Array | null = null; // Int32 view (header + slots)
let statesI32: Int32Array | null = null; // Int32 view for states (header + count/id)
let statesF32: Float32Array | null = null; // Float32 view for states (pos/rot payload)

let stepInterval: number | null = null;

const entityToBody = new Map<number, RigidBody>(); // PHYS_ID → RigidBody
const bodyToEntity = new WeakMap<RigidBody, number>(); // RigidBody → PHYS_ID

let accumulator = 0;
let stepCounter = 0; // counts fixed steps since init (for periodic logs)
let lastStepTimeMs = 0.0; // Metric: wall time for last step batch

const FIXED_DT = 1 / 60;
const GRAVITY = { x: 0.0, y: -9.81, z: 0.0 };

let isInitialized = false;
let rapierPromise: Promise<void> | null = null;

/* ---------------------------------------------
   Helpers
----------------------------------------------*/

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

/* ---------------------------------------------
   Rapier init
----------------------------------------------*/

async function initRapier(): Promise<void> {
  if (rapierPromise) return rapierPromise;

  console.log("Starting Rapier initialization...");

  rapierPromise = new Promise((resolve) => {
    import("@dimforge/rapier3d")
      .then((r) => {
        const start = performance.now();
        RAPIER = r;
        const loadTime = performance.now() - start;
        console.log(`Rapier loaded in ${loadTime.toFixed(2)}ms`);

        world = new RAPIER.World(GRAVITY);
        const params: IntegrationParameters = world.integrationParameters;
        params.dt = FIXED_DT;

        console.log(
          "[PhysicsWorker] Rapier initialized. Gravity:",
          GRAVITY,
          "Fixed dt:",
          FIXED_DT,
        );

        isInitialized = true;
        resolve();
      })
      .catch((error: Error) => {
        console.error("Physics initialization failed:", error);
        RAPIER = null;
        world = null;
        isInitialized = false;
        resolve();
      });
  });

  return rapierPromise;
}

/* ---------------------------------------------
   Commands: drain ring buffer
----------------------------------------------*/

function processCommands(): void {
  if (!commandsView || !world || !RAPIER) return;

  // HEAD (producer writes), TAIL (consumer reads)
  let tail = Atomics.load(commandsView, COMMANDS_TAIL_OFFSET >> 2);
  const head = Atomics.load(commandsView, COMMANDS_HEAD_OFFSET >> 2);

  const slotBaseI32 = COMMANDS_SLOT_OFFSET >> 2;
  let processedAny = false;

  while (tail !== head) {
    // Compute slot offsets
    const slotIndex = tail % COMMANDS_RING_CAPACITY;
    const slotIndexI32 = slotIndex * (COMMANDS_SLOT_SIZE >> 2);
    const slotByteOffset =
      COMMANDS_SLOT_OFFSET + slotIndex * COMMANDS_SLOT_SIZE;

    // Read TYPE and PHYS_ID (Int32 aligned)
    const type = Atomics.load(commandsView, slotBaseI32 + slotIndexI32 + 0);
    const physId = Atomics.load(commandsView, slotBaseI32 + slotIndexI32 + 1);

    // Read PARAMS (Float32 block) - correct byte offset: skip 8 bytes (type+id)
    const paramsView = new Float32Array(
      commandsView.buffer,
      slotByteOffset + 8,
      12,
    );

    if (type === CMD_CREATE_BODY) {
      const colliderType = Math.floor(paramsView[0]); // 0=sphere,1=box,2=capsule
      const p0 = paramsView[1];
      const p1 = paramsView[2];
      const p2 = paramsView[3];

      const pos = { x: paramsView[4], y: paramsView[5], z: paramsView[6] };
      const rot = {
        x: paramsView[7],
        y: paramsView[8],
        z: paramsView[9],
        w: paramsView[10],
      };
      const isDynamic = paramsView[11] > 0.5;

      // Rigid body
      const bodyDesc: RigidBodyDesc = isDynamic
        ? RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(pos.x, pos.y, pos.z)
            .setRotation(rot)
        : RAPIER.RigidBodyDesc.fixed()
            .setTranslation(pos.x, pos.y, pos.z)
            .setRotation(rot);

      const body: RigidBody = world.createRigidBody(bodyDesc);

      // Collider
      let colliderDesc: ColliderDesc | null = null;
      switch (colliderType) {
        case 0: // Sphere
          colliderDesc = RAPIER.ColliderDesc.ball(Math.max(0.001, p0));
          break;
        case 1: // Box (half-extents)
          colliderDesc = RAPIER.ColliderDesc.cuboid(
            Math.max(0.001, p0),
            Math.max(0.001, p1),
            Math.max(0.001, p2),
          );
          break;
        case 2: {
          // Capsule (Rapier 3D uses halfHeight then radius)
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
        world.createCollider(colliderDesc, body);
        entityToBody.set(physId, body);
        bodyToEntity.set(body, physId);
        console.log(
          `[PhysicsWorker] Created body ID=${physId} dynamic=${isDynamic} at [${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}]`,
        );
      } else {
        // Cleanup bad body
        world.removeRigidBody(body);
      }

      processedAny = true;
    } else if (type === CMD_DESTROY_BODY) {
      const body = entityToBody.get(physId);
      if (body) {
        world.removeRigidBody(body);
        entityToBody.delete(physId);
        bodyToEntity.delete(body);
        // console.log(`[PhysicsWorker] Destroyed body ID=${physId}.`);
      } else {
        // console.warn(`[PhysicsWorker] DESTROY for unknown ID=${physId}; ignoring.`);
      }
      processedAny = true;
    } else {
      console.warn(
        `[PhysicsWorker] Unknown command type ${type} for ID=${physId}; ignoring.`,
      );
    }

    // Advance TAIL
    tail = (tail + 1) % COMMANDS_RING_CAPACITY;
    Atomics.store(commandsView, COMMANDS_TAIL_OFFSET >> 2, tail);
  }

  if (processedAny) {
    // Bump generation counter for observability
    Atomics.add(commandsView, COMMANDS_GEN_OFFSET >> 2, 1);
  }
}

/* ---------------------------------------------
   Step + Snapshot
----------------------------------------------*/

function stepWorld(dt: number): void {
  if (!world) return;

  accumulator += dt;
  let totalStepTime = 0;
  const stepStart = performance.now();

  while (accumulator >= FIXED_DT) {
    processCommands(); // drain before each fixed step
    world.step();
    accumulator -= FIXED_DT;
    stepCounter++;
  }

  if (stepCounter > 0) {
    totalStepTime = performance.now() - stepStart;
  }
  lastStepTimeMs = totalStepTime;

  if (stepCounter % 60 === 0 && entityToBody.size > 0) {
    // const b = entityToBody.values().next().value;
    /*
    if (b) {
      const p = b.translation();
      console.log(
        `[PhysicsWorker] Sample body @ [${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}] (steps=${stepCounter})`,
      );
    }
    */
  }
}

function publishSnapshot(): void {
  if (!world || !statesI32 || !statesF32) return;

  // (Publish metric) physics step time
  // This is a non-atomic write, which is fine for metrics.
  statesF32[STATES_PHYSICS_STEP_TIME_MS_OFFSET >> 2] = lastStepTimeMs;

  // Triple buffering: write to next slot, then publish index at end
  const currIdx = Atomics.load(statesI32, STATES_WRITE_INDEX_OFFSET >> 2);
  const nextIdx = (currIdx + 1) % STATES_SLOT_COUNT;

  const slotBaseI32 =
    (STATES_SLOT_OFFSET >> 2) + nextIdx * (STATES_SLOT_SIZE >> 2);
  const slotBaseF32Byte = STATES_SLOT_OFFSET + nextIdx * STATES_SLOT_SIZE;

  // Zero count first
  Atomics.store(statesI32, slotBaseI32, 0);

  let count = 0;
  world.bodies.forEach((body: RigidBody) => {
    if (count >= STATES_MAX_BODIES) return;

    const physId = bodyToEntity.get(body) ?? 0;
    if (physId === 0) return;

    const pos = body.translation();
    const rot = body.rotation();

    // ID (Int32)
    const idOffsetI32 = slotBaseI32 + 1 + count * 8; // 32B per body = 8 i32
    Atomics.store(statesI32, idOffsetI32, physId);

    // Payload (Float32): pos3 + rot4
    const payloadF32 = (slotBaseF32Byte + 8 + count * 32) >> 2; // skip count+id = 8 bytes
    statesF32.set(
      [pos.x, pos.y, pos.z, rot.x, rot.y, rot.z, rot.w],
      payloadF32,
    );

    count++;
  });

  // Write count
  Atomics.store(statesI32, slotBaseI32, count);

  // Publish: update WRITE_INDEX to next slot, then bump GEN
  Atomics.store(statesI32, STATES_WRITE_INDEX_OFFSET >> 2, nextIdx);
  Atomics.add(statesI32, STATES_GEN_OFFSET >> 2, 1);
  // Mirror into READ_GEN (optional)
  Atomics.store(
    statesI32,
    STATES_READ_GEN_OFFSET >> 2,
    Atomics.load(statesI32, STATES_GEN_OFFSET >> 2),
  );

  // Debug:
  // if (count > 0) {
  //   console.log(`[PhysicsWorker] Snapshot published: slot=${nextIdx}, count=${count}, gen=${Atomics.load(statesI32, STATES_GEN_OFFSET >> 2)}`);
  // }
}

/* ---------------------------------------------
   Loop control
----------------------------------------------*/

function startPhysicsLoop(): void {
  let lastTime = performance.now();
  stepInterval = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    stepWorld(dt);
    publishSnapshot();
  }, 1000 / 60);
  console.log("[PhysicsWorker] Fixed-step loop started (60Hz).");
}

function stopPhysicsLoop(): void {
  if (stepInterval != null) {
    clearInterval(stepInterval);
    stepInterval = null;
  }
  if (world) {
    // Remove all rigid bodies we created
    entityToBody.forEach((body) => {
      world?.removeRigidBody(body);
    });
    world.free();
    world = null;
  }
  entityToBody.clear();
  // Do not reassign bodyToEntity (WeakMap); it will be GC'd naturally.
  accumulator = 0;
  stepCounter = 0;
  isInitialized = false;
  console.log("[PhysicsWorker] Loop stopped and resources freed.");
}

/* ---------------------------------------------
   Message handler
----------------------------------------------*/

self.onmessage = async (
  ev: MessageEvent<PhysicsInitMsg | PhysicsStepMsg | PhysicsDestroyMsg>,
) => {
  const msg = ev.data;

  if (msg.type === "INIT") {
    try {
      await initRapier();
      if (!isInitialized || !RAPIER || !world) {
        throw new Error("Rapier init failed; no world available.");
      }

      // Commands SAB
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

      // States SAB
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

      startPhysicsLoop();
      postMessage({ type: "READY" } as PhysicsReadyMsg);
      console.log("[PhysicsWorker] Initialized successfully.");
    } catch (e) {
      const error = e as Error;
      console.error("[PhysicsWorker] Init failed:", error);
      postMessage({ type: "ERROR", error: String(error?.message) });
    }
    return;
  }

  if (!world || !isInitialized) {
    console.warn("[PhysicsWorker] Message ignored; world not initialized.");
    return;
  }

  switch (msg.type) {
    case "STEP": {
      const steps = msg.steps ?? 1;
      for (let i = 0; i < steps; i++) {
        stepWorld(FIXED_DT);
        publishSnapshot();
      }
      postMessage({
        type: "STEP_DONE",
        steps,
        log: `Completed ${steps} steps; bodies=${entityToBody.size}`,
      } as PhysicsStepDoneMsg);
      break;
    }

    case "DESTROY":
      stopPhysicsLoop();
      postMessage({ type: "DESTROYED" } as PhysicsDestroyedMsg);
      break;

    default: {
      const unhandled: never = msg;
      console.warn("[PhysicsWorker] Unknown message:", unhandled);
    }
  }
};

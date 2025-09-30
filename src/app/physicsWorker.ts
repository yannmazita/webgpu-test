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
  COMMANDS_RING_CAPACITY,
  COMMANDS_SLOT_OFFSET,
  COMMANDS_SLOT_SIZE,
  COMMANDS_HEAD_OFFSET,
  COMMANDS_TAIL_OFFSET,
  COMMANDS_GEN_OFFSET,
  // States SAB
  STATES_MAGIC_OFFSET,
  STATES_VERSION_OFFSET,
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
  CMD_MOVE_PLAYER,
  COMMANDS_MAX_PARAMS_F32,
} from "@/core/sharedPhysicsLayout";

// Type imports from Rapier
type RAPIER = typeof import("@dimforge/rapier3d");
type World = import("@dimforge/rapier3d").World;
type RigidBodyDesc = import("@dimforge/rapier3d").RigidBodyDesc;
type RigidBody = import("@dimforge/rapier3d").RigidBody;
type ColliderDesc = import("@dimforge/rapier3d").ColliderDesc;
type Collider = import("@dimforge/rapier3d").Collider;
type IntegrationParameters = import("@dimforge/rapier3d").IntegrationParameters;
type KinematicCharacterController =
  import("@dimforge/rapier3d").KinematicCharacterController;

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
const entityToController = new Map<number, KinematicCharacterController>(); // For player
const playerOnGround = new Map<number, number>(); // PHYS_ID → onGround (1.0/0.0, for player snapshots)
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

/**
 * Drains and processes all pending commands from the shared command ring buffer.
 *
 * This function implements the consumer side of a single-producer/single-consumer
 * (SPSC) queue. It reads commands sent from the render worker (like to create
 * bodies, destroy bodies, or move the player) and executes the corresponding
 * physics operations using the Rapier world.
 *
 * The process for each command is:
 * 1. Read the command `type` and `physId` from the current `tail` slot.
 * 2. Read the associated floating-point `params` payload.
 * 3. Execute a `switch` on the command type to perform the correct action:
 *    - `CMD_CREATE_BODY`: Constructs a Rapier `RigidBody` and `Collider` based
 *      on the parameters. If it's a player, it also creates and configures a
 *      `KinematicCharacterController`.
 *    - `CMD_DESTROY_BODY`: Removes the specified body and its associated
 *      controller from the physics world.
 *    - `CMD_MOVE_PLAYER`: Takes a desired displacement vector, uses the
 *      character controller to compute a collision-safe movement, and applies
 *      the result to the player's kinematic body.
 * 4. Atomically advance the `tail` index to mark the slot as consumed.
 *
 * This function is called within the fixed-step physics loop (`stepWorld`) to
 * ensure commands are processed in sync with the simulation.
 */
function processCommands(): void {
  // --- Guard Clause ---
  if (!commandsView || !world || !RAPIER) {
    return;
  }

  // --- SPSC Ring Buffer Drain Loop ---
  // Atomically load the current head (where the producer writes) and tail
  // (where this consumer reads).
  let tail = Atomics.load(commandsView, COMMANDS_TAIL_OFFSET >> 2);
  const head = Atomics.load(commandsView, COMMANDS_HEAD_OFFSET >> 2);

  const slotBaseI32 = COMMANDS_SLOT_OFFSET >> 2;
  let processedAny = false;

  // Process commands as long as the tail has not caught up to the head.
  while (tail !== head) {
    // Calculate memory offsets for the current command slot.
    const slotIndex = tail % COMMANDS_RING_CAPACITY;
    const slotIndexI32 = slotIndex * (COMMANDS_SLOT_SIZE >> 2);
    const slotByteOffset =
      COMMANDS_SLOT_OFFSET + slotIndex * COMMANDS_SLOT_SIZE;

    // Read command metadata (type and ID).
    const type = Atomics.load(commandsView, slotBaseI32 + slotIndexI32 + 0);
    const physId = Atomics.load(commandsView, slotBaseI32 + slotIndexI32 + 1);

    // Get a view into the floating-point parameter block for this command.
    const paramsView = new Float32Array(
      commandsView.buffer,
      slotByteOffset + 8, // Parameters start after the 8-byte header (type + id).
      COMMANDS_MAX_PARAMS_F32, // The number of float params for the largest command.
    );

    // --- Command Dispatch ---
    if (type === CMD_CREATE_BODY) {
      // --- Create Body Logic ---
      // Unpack parameters for body and collider creation.
      const colliderType = Math.floor(paramsView[0]);
      const p0 = paramsView[1],
        p1 = paramsView[2],
        p2 = paramsView[3];
      const pos = { x: paramsView[4], y: paramsView[5], z: paramsView[6] };
      const rot = {
        x: paramsView[7],
        y: paramsView[8],
        z: paramsView[9],
        w: paramsView[10],
      };
      const bodyTypeInt = Math.floor(paramsView[11]);
      const isPlayer = paramsView[12] > 0.5;
      const slopeAngle = paramsView[13];
      const maxStepHeight = paramsView[14];

      // Select the appropriate Rapier RigidBodyDesc based on the type.
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

      const body: RigidBody = world.createRigidBody(bodyDesc);

      // Create the collider shape.
      let colliderDesc: ColliderDesc | null = null;
      switch (colliderType) {
        case 0: // Sphere
          colliderDesc = RAPIER.ColliderDesc.ball(Math.max(0.001, p0));
          break;
        case 1: // Box (cuboid)
          colliderDesc = RAPIER.ColliderDesc.cuboid(
            Math.max(0.001, p0),
            Math.max(0.001, p1),
            Math.max(0.001, p2),
          );
          break;
        case 2: {
          // Capsule
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
        // If this is the player, create and configure a character controller.
        if (isPlayer) {
          const controller = world.createCharacterController(0.1); // Small collision offset.
          controller.setUp({ x: 0.0, y: 1.0, z: 0.0 }); // Define "up".
          controller.setMaxSlopeClimbAngle(slopeAngle);
          controller.enableAutostep(maxStepHeight, 0.2, true); // Allow climbing small steps.
          controller.enableSnapToGround(0.5); // Help stick to ground on slopes.
          entityToController.set(physId, controller);
          playerOnGround.set(physId, 0.0); // Initialize ground state.
        }
        // Map the physics body back to the ECS entity ID.
        entityToBody.set(physId, body);
        bodyToEntity.set(body, physId);
      } else {
        // If collider creation failed, remove the orphaned rigid body.
        world.removeRigidBody(body);
      }
      processedAny = true;
    } else if (type === CMD_DESTROY_BODY) {
      // --- Destroy Body Logic ---
      const body = entityToBody.get(physId);
      if (body) {
        // If a character controller is associated, remove it first.
        const controller = entityToController.get(physId);
        if (controller) {
          world.removeCharacterController(controller);
          entityToController.delete(physId);
        }
        playerOnGround.delete(physId);
        world.removeRigidBody(body);
        entityToBody.delete(physId);
        bodyToEntity.delete(body); // WeakMap entry will be garbage collected.
      }
      processedAny = true;
    } else if (type === CMD_MOVE_PLAYER) {
      // --- Move Player Logic ---
      const body = entityToBody.get(physId);
      const controller = entityToController.get(physId);
      const collider = body?.collider(0); // Assumes first collider is the character shape.

      if (body && controller && collider) {
        // The displacement vector is complete, with gravity already applied by the PlayerControllerSystem.
        const disp = { x: paramsView[0], y: paramsView[1], z: paramsView[2] };

        // Use the controller to compute a collision-aware movement.
        controller.computeColliderMovement(collider, disp);

        // Apply the corrected movement to the kinematic body.
        const correctedMovement = controller.computedMovement();
        const currentPos = body.translation();
        const nextPos = {
          x: currentPos.x + correctedMovement.x,
          y: currentPos.y + correctedMovement.y,
          z: currentPos.z + correctedMovement.z,
        };
        body.setNextKinematicTranslation(nextPos);

        // Update the ground state for the next snapshot.
        const isOnGround = controller.computedGrounded();
        playerOnGround.set(physId, isOnGround ? 1.0 : 0.0);
      }
      processedAny = true;
    }

    // --- Advance Tail ---
    // Mark the command as processed by advancing the tail index.
    tail = (tail + 1) % COMMANDS_RING_CAPACITY;
    Atomics.store(commandsView, COMMANDS_TAIL_OFFSET >> 2, tail);
  }

  // --- Update Generation Counter ---
  // If any commands were processed, bump the generation counter for observability.
  if (processedAny) {
    Atomics.add(commandsView, COMMANDS_GEN_OFFSET >> 2, 1);
  }
}

/* ---------------------------------------------
   Step + Snapshot
----------------------------------------------*/

function stepWorld(dt: number): void {
  if (!world) return;

  accumulator += dt;
  const stepStart = performance.now();

  while (accumulator >= FIXED_DT) {
    processCommands();
    world.step();
    accumulator -= FIXED_DT;
    stepCounter++;
  }

  lastStepTimeMs = performance.now() - stepStart;
}

/**
 * Publishes a snapshot of all simulated rigid body states to the shared states
 * buffer for consumption by the render worker.
 *
 * This function implements a lock-free, single-producer/single-consumer (SPSC)
 * pattern using a triple-buffered `SharedArrayBuffer`. It writes the state of
 * all tracked rigid bodies (position, rotation, and player-specific flags like
 * `onGround`) into the next available buffer slot.
 *
 * The process is carefully ordered to prevent data races and tearing:
 * 1. The next write slot is determined from the current `WRITE_INDEX`.
 * 2. The body count in that slot is atomically set to zero to invalidate it
 *    during the write process.
 * 3. It iterates through all bodies in the physics world, writing their state
 *    into the slot.
 * 4. The final body count is atomically written to the slot's header.
 * 5. The global `WRITE_INDEX` is atomically updated to point to the newly
 *    filled slot, making it visible to the render worker.
 *
 * A generation counter is also incremented to signal that new data is
 * available. This function must be called after `world.step()` in each
 * physics update.
 *
 * @remarks
 * The physics step time metric (`lastStepTimeMs`) is written non-atomically,
 * as minor tearing is acceptable for simple UI display purposes.
 *
 * The body record layout is `[u32 physId, f32 pos[3], f32 rot[4], f32 onGround]`,
 * totaling 36 bytes per body.
 */
function publishSnapshot(): void {
  // --- Guard Clause ---
  // Exit if the world or shared buffers are not yet initialized.
  if (!world || !statesI32 || !statesF32) {
    return;
  }

  // --- Publish Metrics (Non-Atomic) ---
  // Write the duration of the last physics step. This is for UI display and
  // does not require atomic guarantees.
  statesF32[STATES_PHYSICS_STEP_TIME_MS_OFFSET >> 2] = lastStepTimeMs;

  // --- Triple Buffering: Select Next Slot ---
  // Atomically load the index of the slot the render worker is currently
  // allowed to read, then calculate the next slot for writing.
  const currIdx = Atomics.load(statesI32, STATES_WRITE_INDEX_OFFSET >> 2);
  const nextIdx = (currIdx + 1) % STATES_SLOT_COUNT;

  // --- Prepare Write Slot ---
  // Calculate the base index for the start of the next slot.
  const slotBaseI32 =
    (STATES_SLOT_OFFSET >> 2) + nextIdx * (STATES_SLOT_SIZE >> 2);

  // Atomically set the body count to 0. This invalidates the slot, ensuring
  // the reader doesn't consume partially updated data from a previous frame.
  Atomics.store(statesI32, slotBaseI32, 0);

  // --- Write Body Data ---
  let count = 0;
  world.bodies.forEach((body: RigidBody) => {
    // Stop if we exceed the maximum number of bodies the buffer can hold.
    if (count >= STATES_MAX_BODIES) {
      return;
    }

    // Get the engine-side entity ID mapped to this physics body.
    const physId = bodyToEntity.get(body) ?? 0;
    if (physId === 0) {
      // Skip bodies that aren't tracked by the ECS (e.g., internal).
      return;
    }

    // Extract position, rotation, and player-specific state.
    const pos = body.translation();
    const rot = body.rotation();
    const onGround = playerOnGround.get(physId) ?? 0.0;

    // Calculate the memory offset for this specific body record.
    // Stride is 36 bytes = 9 elements of 32-bits (1 for ID, 8 for payload).
    const recordBaseI32 = slotBaseI32 + 1 + count * 9;

    // Atomically write the integer-based physics ID.
    Atomics.store(statesI32, recordBaseI32, physId);

    // Write the floating-point data payload (pos, rot, onGround) in a block.
    const payloadF32 = recordBaseI32 + 1;
    statesF32.set(
      [pos.x, pos.y, pos.z, rot.x, rot.y, rot.z, rot.w, onGround],
      payloadF32,
    );

    count++;
  });

  // --- Publish Snapshot ---
  // The following atomic operations make the newly written data available.
  // 1. Write the final number of bodies to the slot's header.
  Atomics.store(statesI32, slotBaseI32, count);

  // 2. Update the global write index to point to the slot we just filled.
  //    This is the "commit" that makes the new snapshot live for the reader.
  Atomics.store(statesI32, STATES_WRITE_INDEX_OFFSET >> 2, nextIdx);

  // 3. Increment the generation counter to signal to any listeners that a new
  //    snapshot has been published.
  Atomics.add(statesI32, STATES_GEN_OFFSET >> 2, 1);

  // 4. Mirror the generation counter for debugging.
  Atomics.store(
    statesI32,
    STATES_READ_GEN_OFFSET >> 2,
    Atomics.load(statesI32, STATES_GEN_OFFSET >> 2),
  );
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
    entityToBody.forEach((body, physId) => {
      const controller = entityToController.get(physId);
      if (controller) world?.removeCharacterController(controller);
      world?.removeRigidBody(body);
    });
    world.free();
    world = null;
  }
  entityToBody.clear();
  entityToController.clear();
  playerOnGround.clear();
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
    } catch (e) {
      const error = e as Error;
      console.error("[PhysicsWorker] Init failed:", error);
      postMessage({ type: "ERROR", error: String(error?.message) });
    }
    return;
  }

  if (!world || !isInitialized) return;

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
  }
};

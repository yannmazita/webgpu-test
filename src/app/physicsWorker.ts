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
  CMD_WEAPON_RAYCAST,
  CMD_INTERACTION_RAYCAST,
  COMMANDS_MAX_PARAMS_F32,
  RAYCAST_RESULTS_MAGIC,
  RAYCAST_RESULTS_VERSION,
  RAYCAST_RESULTS_MAGIC_OFFSET,
  RAYCAST_RESULTS_VERSION_OFFSET,
  RAYCAST_RESULTS_GEN_OFFSET,
  RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET,
  RAYCAST_RESULTS_HIT_DISTANCE_OFFSET,
  CMD_CREATE_BODY_PARAMS,
  RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET,
  INTERACTION_RAYCAST_RESULTS_MAGIC,
  INTERACTION_RAYCAST_RESULTS_VERSION,
  INTERACTION_RAYCAST_RESULTS_MAGIC_OFFSET,
  INTERACTION_RAYCAST_RESULTS_VERSION_OFFSET,
  INTERACTION_RAYCAST_RESULTS_GEN_OFFSET,
  INTERACTION_RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET,
  INTERACTION_RAYCAST_RESULTS_HIT_DISTANCE_OFFSET,
  INTERACTION_RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET,
  CHAR_CONTROLLER_EVENTS_MAGIC_OFFSET,
  CHAR_CONTROLLER_EVENTS_VERSION_OFFSET,
  CHAR_CONTROLLER_EVENTS_MAGIC,
  CHAR_CONTROLLER_EVENTS_VERSION,
  CHAR_CONTROLLER_EVENTS_HEAD_OFFSET,
  CHAR_CONTROLLER_EVENTS_TAIL_OFFSET,
  CHAR_CONTROLLER_EVENTS_SLOT_OFFSET,
  CHAR_CONTROLLER_EVENTS_RING_CAPACITY,
  CHAR_CONTROLLER_EVENTS_SLOT_SIZE,
  CHAR_EVENT_PHYS_ID_OFFSET,
  CHAR_EVENT_TYPE_OFFSET,
  CHAR_EVENT_DATA1_X_OFFSET,
  CHAR_EVENT_DATA1_Y_OFFSET,
  CHAR_EVENT_DATA1_Z_OFFSET,
  CHAR_EVENT_DATA2_OFFSET,
  CHAR_EVENT_GROUND_ENTITY_OFFSET,
  CHAR_EVENT_GROUNDED,
  CHAR_EVENT_AIRBORNE,
  CHAR_EVENT_WALL_CONTACT,
  CHAR_EVENT_STEP_CLIMBED,
  CHAR_EVENT_CEILING_HIT,
  CHAR_EVENT_SLIDE_START,
  CHAR_EVENT_SLIDE_STOP,
  COLLISION_EVENTS_HEAD_OFFSET,
  COLLISION_EVENTS_RING_CAPACITY,
  COLLISION_EVENTS_SLOT_OFFSET,
  COLLISION_EVENTS_SLOT_SIZE,
  COLLISION_EVENTS_TAIL_OFFSET,
  COLLISION_EVENT_FLAG_STARTED,
  COLLISION_EVENT_FLAG_ENDED,
  COLLISION_EVENT_FLAG_SENSOR_ENTERED,
  COLLISION_EVENT_FLAG_SENSOR_EXITED,
  COLLISION_EVENT_PHYS_ID_A_OFFSET,
  COLLISION_EVENT_PHYS_ID_B_OFFSET,
  COLLISION_EVENT_FLAGS_OFFSET,
  COLLISION_EVENT_CONTACT_X_OFFSET,
  COLLISION_EVENT_CONTACT_Y_OFFSET,
  COLLISION_EVENT_CONTACT_Z_OFFSET,
  COLLISION_EVENT_NORMAL_X_OFFSET,
  COLLISION_EVENT_NORMAL_Y_OFFSET,
  COLLISION_EVENT_NORMAL_Z_OFFSET,
  COLLISION_EVENT_IMPULSE_OFFSET,
  COLLISION_EVENT_PENETRATION_OFFSET,
  COLLISION_EVENT_RESERVED_0_OFFSET,
  COLLISION_EVENTS_GEN_OFFSET,
  CHAR_CONTROLLER_EVENTS_GEN_OFFSET,
  COLLISION_EVENTS_MAGIC_OFFSET,
  COLLISION_EVENTS_MAGIC,
  COLLISION_EVENTS_VERSION_OFFSET,
  COLLISION_EVENTS_VERSION,
  CHAR_EVENT_RESERVED_0_OFFSET,
  CHAR_EVENT_RESERVED_1_OFFSET,
} from "@/core/sharedPhysicsLayout";

import { floatToInt32Bits, int32BitsToFloat } from "@/core/utils/bitConversion";

// Import Rapier physics module
import {
  initRapier,
  getRapierModule,
  createWorld,
  isRapierReady,
  World,
  RigidBodyDesc,
  RigidBody,
  ColliderDesc,
  KinematicCharacterController,
  EventQueue,
  TempContactForceEvent,
} from "@/core/wasm/rapierModule";

/**
 * Physics worker:
 * - Initializes Rapier in a Web Worker
 * - Processes commands from a ring buffer (SAB)
 * - Steps world at fixed 60Hz with an accumulator
 * - Publishes snapshots to a triple-buffered states SAB
 */

let world: World | null = null;

let commandsView: Int32Array | null = null; // Int32 view (header + slots)
let statesI32: Int32Array | null = null; // Int32 view for states (header + count/id)
let statesF32: Float32Array | null = null; // Float32 view for states (pos/rot payload)
let raycastResultsI32: Int32Array | null = null;
let raycastResultsF32: Float32Array | null = null;
let interactionRaycastResultsI32: Int32Array | null = null;
let collisionEventsI32: Int32Array | null = null;
let collisionEventsF32: Float32Array | null = null;
let charControllerEventsI32: Int32Array | null = null;
let charControllerEventsF32: Float32Array | null = null;

let stepInterval: number | null = null;
let eventQueue: EventQueue | null = null;

const entityToBody = new Map<number, RigidBody>(); // PHYS_ID → RigidBody
const entityToController = new Map<number, KinematicCharacterController>(); // For player
const playerOnGround = new Map<number, number>(); // PHYS_ID → onGround (1.0/0.0, for player snapshots)
const playerSliding = new Map<number, boolean>(); // PHYS_ID → isSliding state for event transitions
const bodyToEntity = new WeakMap<RigidBody, number>(); // RigidBody → PHYS_ID

let accumulator = 0;
let stepCounter = 0; // counts fixed steps since init (for periodic logs)
let lastStepTimeMs = 0.0; // Metric: wall time for last step batch

const FIXED_DT = 1 / 60;
const GRAVITY = { x: 0.0, y: -9.81, z: 0.0 };

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

/**
 * Initializes Rapier and creates the physics world.
 *
 * @remarks
 * This function uses the centralized `rapierModule` for WASM loading. It
 * creates a `World` instance owned by this worker and also instantiates a
 * Rapier `EventQueue` to capture collision events, which are essential for
 * gameplay logic.
 *
 * @returns A promise that resolves on successful initialization or rejects on
 *     failure.
 */
async function initializePhysics(): Promise<void> {
  try {
    // Initialize the Rapier WASM module
    await initRapier();
    const rapierModule = getRapierModule();

    if (!isRapierReady()) {
      throw new Error("Rapier module failed to initialize");
    }

    // Create the physics world owned by this worker
    world = createWorld(GRAVITY, FIXED_DT);
    if (rapierModule) {
      // Create the event queue
      eventQueue = new rapierModule.EventQueue(true);
    }

    console.log("[PhysicsWorker] Physics initialized successfully");
  } catch (error) {
    console.error("[PhysicsWorker] Initialization failed:", error);
    world = null;
    throw error;
  }
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
  const RAPIER = getRapierModule();
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
      const P = CMD_CREATE_BODY_PARAMS;
      const colliderType = Math.floor(paramsView[P.COLLIDER_TYPE]);
      const p0 = paramsView[P.PARAM_0],
        p1 = paramsView[P.PARAM_1],
        p2 = paramsView[P.PARAM_2];
      const pos = {
        x: paramsView[P.POS_X],
        y: paramsView[P.POS_Y],
        z: paramsView[P.POS_Z],
      };
      const rot = {
        x: paramsView[P.ROT_X],
        y: paramsView[P.ROT_Y],
        z: paramsView[P.ROT_Z],
        w: paramsView[P.ROT_W],
      };
      const bodyTypeInt = Math.floor(paramsView[P.BODY_TYPE]);
      const isPlayer = paramsView[P.IS_PLAYER] > 0.5;
      const slopeAngle = paramsView[P.SLOPE_ANGLE];
      const maxStepHeight = paramsView[P.MAX_STEP_HEIGHT];
      const vel = {
        x: paramsView[P.VEL_X],
        y: paramsView[P.VEL_Y],
        z: paramsView[P.VEL_Z],
      };

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
      if (vel.x !== 0 || vel.y !== 0 || vel.z !== 0) {
        bodyDesc.setLinvel(vel.x, vel.y, vel.z);
      }

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
        // By default, Rapier does not report events for performance. We must opt-in.
        colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

        // Don't set collision groups - use default behavior (everything collides)
        // The raycast filtering will handle excluding the player via filterExcludeRigidBody

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
          playerSliding.set(physId, false); // Initialize sliding state.
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
        playerSliding.delete(physId);
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
    } else if (type === CMD_WEAPON_RAYCAST) {
      if (raycastResultsI32 && raycastResultsF32) {
        const origin = {
          x: paramsView[0],
          y: paramsView[1],
          z: paramsView[2],
        };
        const dir = { x: paramsView[3], y: paramsView[4], z: paramsView[5] };
        const maxToi = paramsView[6];
        const ray = new RAPIER.Ray(origin, dir);

        // Get the player's rigid body to exclude it from the raycast
        const playerBody = entityToBody.get(physId);

        // Cast ray with proper parameters:
        // castRayAndGetNormal(ray, maxToi, solid, filterFlags?, filterGroups?,
        //                     filterExcludeCollider?, filterExcludeRigidBody?, filterPredicate?)
        const hit = world.castRayAndGetNormal(
          ray,
          maxToi,
          true, // solid
          undefined, // filterFlags - use default (no filtering by type)
          undefined, // filterGroups - use default (hit everything)
          undefined, // filterExcludeCollider - not needed
          playerBody, // filterExcludeRigidBody - exclude the player's rigid body
        );

        if (hit) {
          const hitPoint = ray.pointAt(hit.timeOfImpact);
          const hitBody = hit.collider.parent();
          const hitEntityId = hitBody ? (bodyToEntity.get(hitBody) ?? 0) : 0;

          Atomics.store(
            raycastResultsI32,
            RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET >> 2,
            hitEntityId,
          );
          raycastResultsF32.set(
            [hit.timeOfImpact, hitPoint.x, hitPoint.y, hitPoint.z],
            RAYCAST_RESULTS_HIT_DISTANCE_OFFSET >> 2,
          );
        } else {
          // No hit, store 0
          Atomics.store(
            raycastResultsI32,
            RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET >> 2,
            0,
          );
        }
        // Store the source of the raycast regardless of hit
        Atomics.store(
          raycastResultsI32,
          RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET >> 2,
          physId, // This is the source entity ID from the command
        );
        // Signal new result is available
        Atomics.add(raycastResultsI32, RAYCAST_RESULTS_GEN_OFFSET >> 2, 1);
      }
      processedAny = true;
    } else if (type === CMD_INTERACTION_RAYCAST) {
      if (interactionRaycastResultsI32) {
        const origin = {
          x: paramsView[0],
          y: paramsView[1],
          z: paramsView[2],
        };
        const dir = { x: paramsView[3], y: paramsView[4], z: paramsView[5] };
        const maxToi = paramsView[6];
        const ray = new RAPIER.Ray(origin, dir);
        const sourceBody = entityToBody.get(physId);

        const hit = world.castRay(
          ray,
          maxToi,
          true, // solid
          undefined,
          undefined,
          undefined,
          sourceBody,
        );

        let hitEntityId = 0;
        let hitDistance = -1.0;

        if (hit) {
          const hitBody = hit.collider.parent();
          hitEntityId = hitBody ? (bodyToEntity.get(hitBody) ?? 0) : 0;
          hitDistance = hit.timeOfImpact;
        }

        Atomics.store(
          interactionRaycastResultsI32,
          INTERACTION_RAYCAST_RESULTS_HIT_ENTITY_ID_OFFSET >> 2,
          hitEntityId,
        );
        Atomics.store(
          interactionRaycastResultsI32,
          INTERACTION_RAYCAST_RESULTS_HIT_DISTANCE_OFFSET >> 2,
          floatToInt32Bits(hitDistance),
        );
        Atomics.store(
          interactionRaycastResultsI32,
          INTERACTION_RAYCAST_RESULTS_SOURCE_ENTITY_ID_OFFSET >> 2,
          physId,
        );
        Atomics.add(
          interactionRaycastResultsI32,
          INTERACTION_RAYCAST_RESULTS_GEN_OFFSET >> 2,
          1,
        );
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

/**
 * Advances the physics simulation by a fixed time step (`FIXED_DT`).
 *
 * @remarks
 * This function manages a time accumulator to ensure the simulation runs at a
 * consistent rate, independent of the main loop's frame rate. For each fixed
 * step, it first processes all pending commands from the render worker, then
 * steps the Rapier `World` along with its `EventQueue`.
 *
 * @param dt - The delta time in seconds since the last call.
 */
function stepWorld(dt: number): void {
  if (!world || !eventQueue) return;

  accumulator += dt;
  const stepStart = performance.now();

  while (accumulator >= FIXED_DT) {
    processCommands();
    world.step(eventQueue);
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

function getWallNormal(
  controller: KinematicCharacterController,
  body: RigidBody,
): { x: number; y: number; z: number } {
  // todo: perform raycasts or check collision contacts
  // for testing just returning a normalized horizontal velocity direction as approximation
  const velocity = body.linvel();
  const horizontalSpeed = Math.sqrt(
    velocity.x * velocity.x + velocity.z * velocity.z,
  );

  if (horizontalSpeed > 0.01) {
    return {
      x: -velocity.x / horizontalSpeed, // Negative because wall normal opposes movement
      y: 0,
      z: -velocity.z / horizontalSpeed,
    };
  }

  return { x: 1, y: 0, z: 0 };
}

function checkStepClimbed(
  controller: KinematicCharacterController,
  body: RigidBody,
): number {
  // We need to track previous position to detect step climbing
  const physId = bodyToEntity.get(body);
  if (!physId) return 0;

  // Get previous position from tracking
  const prevPos = (
    body.userData as { prevPos?: { x: number; y: number; z: number } }
  )?.prevPos;
  const currPos = body.translation();

  // Store current position for next frame
  body.userData ??= {};
  (body.userData as { prevPos: { x: number; y: number; z: number } }).prevPos =
    { ...currPos };

  if (prevPos && controller.computedGrounded()) {
    const deltaY = currPos.y - prevPos.y;
    // Detect upward step (small positive Y change while grounded)
    if (deltaY > 0.05 && deltaY < 0.5) {
      // Between 5cm and 50cm
      return deltaY;
    }
  }

  return 0;
}

function getSlideData(
  controller: KinematicCharacterController,
  body: RigidBody,
): { x: number; y: number; z: number; w: number } {
  // Return slide direction and speed
  const velocity = body.linvel();
  const horizontalSpeed = Math.sqrt(
    velocity.x * velocity.x + velocity.z * velocity.z,
  );

  if (horizontalSpeed > 0.01) {
    // Normalize horizontal velocity for direction
    return {
      x: velocity.x / horizontalSpeed,
      y: 0,
      z: velocity.z / horizontalSpeed,
      w: horizontalSpeed, // Speed as w component
    };
  }

  return { x: 0, y: 0, z: 0, w: 0 };
}

function checkWallContact(
  controller: KinematicCharacterController,
  body: RigidBody,
): { isContact: boolean; normal: { x: number; y: number; z: number } } {
  const RAPIER = getRapierModule();
  if (!RAPIER || !world)
    return { isContact: false, normal: { x: 1, y: 0, z: 0 } };

  const pos = body.translation();
  const velocity = body.linvel();
  const isMovingHorizontally =
    Math.abs(velocity.x) > 0.1 || Math.abs(velocity.z) > 0.1;

  if (!isMovingHorizontally || controller.computedGrounded()) {
    return { isContact: false, normal: { x: 1, y: 0, z: 0 } };
  }

  // Cast rays in the direction of movement to detect walls
  const moveDir = { x: velocity.x, y: 0, z: velocity.z };
  const moveLength = Math.sqrt(moveDir.x * moveDir.x + moveDir.z * moveDir.z);

  if (moveLength > 0.01) {
    moveDir.x /= moveLength;
    moveDir.z /= moveLength;

    // Raycast forward
    const ray = new RAPIER.Ray(pos, moveDir);
    const hit = world.castRay(
      ray,
      0.5,
      true,
      undefined,
      undefined,
      undefined,
      body,
    );

    if (hit && hit.timeOfImpact < 0.3) {
      // Wall within 30cm
      // Calculate normal from hit point
      const hitPoint = ray.pointAt(hit.timeOfImpact);
      const toHit = {
        x: hitPoint.x - pos.x,
        y: hitPoint.y - pos.y,
        z: hitPoint.z - pos.z,
      };
      const length = Math.sqrt(
        toHit.x * toHit.x + toHit.y * toHit.y + toHit.z * toHit.z,
      );

      if (length > 0.01) {
        return {
          isContact: true,
          normal: {
            x: -toHit.x / length, // Normal points away from wall
            y: -toHit.y / length,
            z: -toHit.z / length,
          },
        };
      }
    }
  }

  return { isContact: false, normal: { x: 1, y: 0, z: 0 } };
}

function checkCeilingHit(
  controller: KinematicCharacterController,
  body: RigidBody,
): boolean {
  const RAPIER = getRapierModule();
  if (!RAPIER || !world) return false;

  const velocity = body.linvel();
  const isTryingToMoveUp = velocity.y > 0.1;

  if (!isTryingToMoveUp) return false;

  // Cast ray upward to check for ceiling
  const pos = body.translation();
  const ray = new RAPIER.Ray(pos, { x: 0, y: 1, z: 0 });
  const hit = world.castRay(
    ray,
    0.5,
    true,
    undefined,
    undefined,
    undefined,
    body,
  );

  // If there's a hit close above, we're hitting a ceiling
  return hit !== null && hit.timeOfImpact < 0.3; // Ceiling within 30cm
}

function checkSlidingState(
  controller: KinematicCharacterController,
  body: RigidBody,
): { isSliding: boolean; slopeNormal?: { x: number; y: number; z: number } } {
  const RAPIER = getRapierModule();
  if (!RAPIER || !world || !controller.computedGrounded()) {
    return { isSliding: false };
  }

  // Raycast down to get ground normal
  const pos = body.translation();
  const ray = new RAPIER.Ray(pos, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(
    ray,
    1.0,
    true,
    undefined,
    undefined,
    undefined,
    body,
  );

  if (hit) {
    // Calculate ground normal from the hit
    // simple, should get the normal from the contact
    const groundNormal = { x: 0, y: 1, z: 0 }; // Default to up

    // Check slope angle (dot product with up vector)
    const slopeAngle = Math.acos(Math.max(-1, Math.min(1, groundNormal.y)));
    const maxSlopeAngle = controller.maxSlopeClimbAngle();

    // If slope is steeper than max climb angle, we're sliding
    const isSliding = slopeAngle > maxSlopeAngle;

    return { isSliding, slopeNormal: groundNormal };
  }

  return { isSliding: false };
}

/**
 * Drains character controller events and publishes them to the shared buffer.
 *
 * This function captures character controller-specific events like ground contact,
 * wall sliding, step climbing, etc. and publishes them for gameplay systems to consume.
 */
function publishCharacterControllerEvents(): void {
  const eventsI32 = charControllerEventsI32;
  const eventsF32 = charControllerEventsF32;

  if (!world || !eventsI32 || !eventsF32 || entityToController.size === 0) {
    return;
  }

  const writeEventVec3 = (
    slotBaseI32: number,
    x: number,
    y: number,
    z: number,
  ): void => {
    eventsF32[slotBaseI32 + (CHAR_EVENT_DATA1_X_OFFSET >> 2)] = x;
    eventsF32[slotBaseI32 + (CHAR_EVENT_DATA1_Y_OFFSET >> 2)] = y;
    eventsF32[slotBaseI32 + (CHAR_EVENT_DATA1_Z_OFFSET >> 2)] = z;
  };

  const writeEventData2 = (slotBaseI32: number, value: number): void => {
    eventsF32[slotBaseI32 + (CHAR_EVENT_DATA2_OFFSET >> 2)] = value;
  };

  let head = Atomics.load(eventsI32, CHAR_CONTROLLER_EVENTS_HEAD_OFFSET >> 2);
  const tail = Atomics.load(eventsI32, CHAR_CONTROLLER_EVENTS_TAIL_OFFSET >> 2);
  let eventsPublished = 0;

  entityToController.forEach((controller, physId) => {
    const body = entityToBody.get(physId);
    if (!body) return;

    const grounded = controller.computedGrounded();
    const prevOnGround = playerOnGround.get(physId) ?? 0.0;
    const currOnGround = grounded ? 1.0 : 0.0;

    if (prevOnGround !== currOnGround) {
      const nextHead = (head + 1) % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      if (nextHead === tail) return;

      const slotIndex = head % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (CHAR_CONTROLLER_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (CHAR_CONTROLLER_EVENTS_SLOT_SIZE >> 2);

      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_PHYS_ID_OFFSET >> 2),
        physId,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_TYPE_OFFSET >> 2),
        currOnGround > 0.5 ? CHAR_EVENT_GROUNDED : CHAR_EVENT_AIRBORNE,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_GROUND_ENTITY_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_0_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_1_OFFSET >> 2),
        0,
      );
      writeEventVec3(slotBaseI32, 0.0, 0.0, 0.0);
      writeEventData2(slotBaseI32, 0.0);

      head = nextHead;
      eventsPublished++;
    }

    const wallContact = checkWallContact(controller, body);
    if (wallContact.isContact) {
      const nextHead = (head + 1) % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      if (nextHead === tail) return;

      const slotIndex = head % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (CHAR_CONTROLLER_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (CHAR_CONTROLLER_EVENTS_SLOT_SIZE >> 2);

      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_PHYS_ID_OFFSET >> 2),
        physId,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_TYPE_OFFSET >> 2),
        CHAR_EVENT_WALL_CONTACT,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_GROUND_ENTITY_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_0_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_1_OFFSET >> 2),
        0,
      );
      writeEventVec3(
        slotBaseI32,
        wallContact.normal.x,
        wallContact.normal.y,
        wallContact.normal.z,
      );
      writeEventData2(slotBaseI32, 0.0);

      head = nextHead;
      eventsPublished++;
    }

    const stepHeight = checkStepClimbed(controller, body);
    if (stepHeight > 0) {
      const nextHead = (head + 1) % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      if (nextHead === tail) return;

      const slotIndex = head % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (CHAR_CONTROLLER_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (CHAR_CONTROLLER_EVENTS_SLOT_SIZE >> 2);

      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_PHYS_ID_OFFSET >> 2),
        physId,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_TYPE_OFFSET >> 2),
        CHAR_EVENT_STEP_CLIMBED,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_GROUND_ENTITY_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_0_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_1_OFFSET >> 2),
        0,
      );
      writeEventVec3(slotBaseI32, 0.0, 0.0, 0.0);
      writeEventData2(slotBaseI32, stepHeight);

      head = nextHead;
      eventsPublished++;
    }

    if (checkCeilingHit(controller, body)) {
      const nextHead = (head + 1) % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      if (nextHead === tail) return;

      const slotIndex = head % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (CHAR_CONTROLLER_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (CHAR_CONTROLLER_EVENTS_SLOT_SIZE >> 2);

      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_PHYS_ID_OFFSET >> 2),
        physId,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_TYPE_OFFSET >> 2),
        CHAR_EVENT_CEILING_HIT,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_GROUND_ENTITY_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_0_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_1_OFFSET >> 2),
        0,
      );
      writeEventVec3(slotBaseI32, 0.0, -1.0, 0.0);
      writeEventData2(slotBaseI32, 0.0);

      head = nextHead;
      eventsPublished++;
    }

    const slidingState = checkSlidingState(controller, body);
    const prevSliding = playerSliding.get(physId) ?? false;
    const currSliding = slidingState.isSliding;

    if (prevSliding !== currSliding) {
      const nextHead = (head + 1) % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      if (nextHead === tail) return;

      const slotIndex = head % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (CHAR_CONTROLLER_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (CHAR_CONTROLLER_EVENTS_SLOT_SIZE >> 2);

      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_PHYS_ID_OFFSET >> 2),
        physId,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_TYPE_OFFSET >> 2),
        currSliding ? CHAR_EVENT_SLIDE_START : CHAR_EVENT_SLIDE_STOP,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_GROUND_ENTITY_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_0_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_1_OFFSET >> 2),
        0,
      );

      const slideData = getSlideData(controller, body);
      writeEventVec3(slotBaseI32, slideData.x, slideData.y, slideData.z);
      writeEventData2(slotBaseI32, slideData.w);

      head = nextHead;
      eventsPublished++;
    }

    playerOnGround.set(physId, currOnGround);
    playerSliding.set(physId, currSliding);
  });

  if (eventsPublished > 0) {
    Atomics.store(eventsI32, CHAR_CONTROLLER_EVENTS_HEAD_OFFSET >> 2, head);
    Atomics.add(eventsI32, CHAR_CONTROLLER_EVENTS_GEN_OFFSET >> 2, 1);
  }
}

/**
 * Drains Rapier's event queue and publishes collision events to the shared buffer.
 *
 * @remarks
 * This function implements the producer side of a single-producer/single-consumer
 * ring buffer for collision events. It iterates through all collision events
 * generated by the last `world.step()`, translates collider handles into
 * entity IDs, and writes them into the shared buffer for the `CollisionEventSystem`
 * to consume. The `head` pointer is advanced atomically after writing.
 */
function publishCollisionEvents(): void {
  if (!world || !eventQueue || !collisionEventsI32) {
    return;
  }

  // SPSC Ring Buffer producer logic
  let head = Atomics.load(
    collisionEventsI32,
    COLLISION_EVENTS_HEAD_OFFSET >> 2,
  );
  const tail = Atomics.load(
    collisionEventsI32,
    COLLISION_EVENTS_TAIL_OFFSET >> 2,
  );

  let eventsPublished = 0;

  // First, collect collision events (start/stop)
  const collisionEvents = new Map<
    string,
    {
      started: boolean;
      handle1: number;
      handle2: number;
      physIdA?: number;
      physIdB?: number;
      isSensor: boolean;
    }
  >();

  eventQueue.drainCollisionEvents(
    (handle1: number, handle2: number, started: boolean) => {
      const collider1 = world?.colliders.get(handle1);
      const collider2 = world?.colliders.get(handle2);
      if (!collider1 || !collider2) return;

      const body1 = collider1.parent();
      const body2 = collider2.parent();
      if (!body1 || !body2) return;

      const physIdA = bodyToEntity.get(body1);
      const physIdB = bodyToEntity.get(body2);
      if (!physIdA || !physIdB) return;

      const key = `${handle1}-${handle2}`;
      collisionEvents.set(key, {
        started,
        handle1,
        handle2,
        physIdA,
        physIdB,
        isSensor: collider1.isSensor() || collider2.isSensor(),
      });
    },
  );

  // Then, collect contact force events for detailed data
  eventQueue.drainContactForceEvents(
    (tempContactForceEvent: TempContactForceEvent) => {
      // Extract collider handles from the event
      const handle1 = tempContactForceEvent.collider1();
      const handle2 = tempContactForceEvent.collider2();

      const key1 = `${handle1}-${handle2}`;
      const key2 = `${handle2}-${handle1}`;
      const collision = collisionEvents.get(key1) || collisionEvents.get(key2);

      // If no matching collision event, create one for the contact force
      if (!collision) {
        const collider1 = world?.colliders.get(handle1);
        const collider2 = world?.colliders.get(handle2);
        if (!collider1 || !collider2) return;

        const body1 = collider1.parent();
        const body2 = collider2.parent();
        if (!body1 || !body2) return;

        const physIdA = bodyToEntity.get(body1);
        const physIdB = bodyToEntity.get(body2);
        if (!physIdA || !physIdB) return;

        // Create a temporary collision entry for this contact force event
        collisionEvents.set(key1, {
          started: true,
          handle1,
          handle2,
          physIdA,
          physIdB,
          isSensor: collider1.isSensor() || collider2.isSensor(),
        });
      }

      const nextHead = (head + 1) % COLLISION_EVENTS_RING_CAPACITY;
      if (nextHead === tail) {
        // Buffer is full, drop event.
        return;
      }

      const slotIndex = head % COLLISION_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (COLLISION_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (COLLISION_EVENTS_SLOT_SIZE >> 2);

      // Store basic collision info
      const physIdA =
        bodyToEntity.get(world?.colliders.get(handle1)?.parent() ?? null) ?? 0;
      const physIdB =
        bodyToEntity.get(world?.colliders.get(handle2)?.parent() ?? null) ?? 0;

      Atomics.store(
        collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_PHYS_ID_A_OFFSET >> 2),
        physIdA,
      );
      Atomics.store(
        collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_PHYS_ID_B_OFFSET >> 2),
        physIdB,
      );

      // Determine event flags
      let flags = COLLISION_EVENT_FLAG_STARTED; // Contact force events imply active contact
      if (
        world?.colliders.get(handle1)?.isSensor() ||
        world?.colliders.get(handle2)?.isSensor()
      ) {
        flags = COLLISION_EVENT_FLAG_SENSOR_ENTERED;
      }
      Atomics.store(
        collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_FLAGS_OFFSET >> 2),
        flags,
      );

      // Store reserved field
      Atomics.store(
        collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_RESERVED_0_OFFSET >> 2),
        0,
      );

      // Extract data from TempContactForceEvent
      const maxForceDirection = tempContactForceEvent.maxForceDirection();
      const maxForceMagnitude = tempContactForceEvent.maxForceMagnitude();
      const totalForce = tempContactForceEvent.totalForce();
      const totalForceMagnitude = tempContactForceEvent.totalForceMagnitude();

      // Get collider positions for contact point approximation
      const collider1 = world?.colliders.get(handle1);
      const collider2 = world?.colliders.get(handle2);

      let contactPoint = { x: 0, y: 0, z: 0 };
      if (collider1 && collider2) {
        const pos1 = collider1.translation();
        const pos2 = collider2.translation();
        contactPoint = {
          x: (pos1.x + pos2.x) / 2,
          y: (pos1.y + pos2.y) / 2,
          z: (pos1.z + pos2.z) / 2,
        };
      }

      // Store contact point (approximated as midpoint)
      Atomics.store(
        collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_CONTACT_X_OFFSET >> 2),
        floatToInt32Bits(contactPoint.x),
      );
      Atomics.store(
        collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_CONTACT_Y_OFFSET >> 2),
        floatToInt32Bits(contactPoint.y),
      );
      Atomics.store(
        collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_CONTACT_Z_OFFSET >> 2),
        floatToInt32Bits(contactPoint.z),
      );

      // Store normal (using max force direction)
      Atomics.store(
        collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_NORMAL_X_OFFSET >> 2),
        floatToInt32Bits(maxForceDirection.x),
      );
      Atomics.store(
        collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_NORMAL_Y_OFFSET >> 2),
        floatToInt32Bits(maxForceDirection.y),
      );
      Atomics.store(
        collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_NORMAL_Z_OFFSET >> 2),
        floatToInt32Bits(maxForceDirection.z),
      );

      // Store impulse/force magnitude (use max force for impact)
      Atomics.store(
        collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_IMPULSE_OFFSET >> 2),
        floatToInt32Bits(maxForceMagnitude),
      );

      // Penetration depth - not directly available, estimate from force
      // This is a rough approximation, todo: could have to use 0 or calculate differently
      const estimatedPenetration = Math.min(maxForceMagnitude / 1000.0, 0.1); // Rough estimate
      Atomics.store(
        collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_PENETRATION_OFFSET >> 2),
        floatToInt32Bits(estimatedPenetration),
      );

      // Free the temporary event to prevent WASM memory leaks
      tempContactForceEvent.free();

      head = nextHead;
      eventsPublished++;
    },
  );

  // Also handle collision events that don't have contact force data (ie sensor events without force)
  collisionEvents.forEach((collision, key) => {
    const nextHead = (head + 1) % COLLISION_EVENTS_RING_CAPACITY;
    if (nextHead === tail) return;

    const slotIndex = head % COLLISION_EVENTS_RING_CAPACITY;
    const slotBaseI32 =
      (COLLISION_EVENTS_SLOT_OFFSET >> 2) +
      slotIndex * (COLLISION_EVENTS_SLOT_SIZE >> 2);

    // Store basic collision info
    Atomics.store(
      collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_PHYS_ID_A_OFFSET >> 2),
      collision.physIdA,
    );
    Atomics.store(
      collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_PHYS_ID_B_OFFSET >> 2),
      collision.physIdB,
    );

    let flags = collision.started
      ? COLLISION_EVENT_FLAG_STARTED
      : COLLISION_EVENT_FLAG_ENDED;
    if (collision.isSensor) {
      flags = collision.started
        ? COLLISION_EVENT_FLAG_SENSOR_ENTERED
        : COLLISION_EVENT_FLAG_SENSOR_EXITED;
    }
    Atomics.store(
      collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_FLAGS_OFFSET >> 2),
      flags,
    );
    Atomics.store(
      collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_RESERVED_0_OFFSET >> 2),
      0,
    );

    // Store defaults for events without detailed contact data
    Atomics.store(
      collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_CONTACT_X_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );
    Atomics.store(
      collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_CONTACT_Y_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );
    Atomics.store(
      collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_CONTACT_Z_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );
    Atomics.store(
      collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_NORMAL_X_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );
    Atomics.store(
      collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_NORMAL_Y_OFFSET >> 2),
      floatToInt32Bits(1.0),
    );
    Atomics.store(
      collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_NORMAL_Z_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );
    Atomics.store(
      collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_IMPULSE_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );
    Atomics.store(
      collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_PENETRATION_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );

    head = nextHead;
    eventsPublished++;
  });

  if (eventsPublished > 0) {
    Atomics.store(collisionEventsI32, COLLISION_EVENTS_HEAD_OFFSET >> 2, head);
    Atomics.add(collisionEventsI32, COLLISION_EVENTS_GEN_OFFSET >> 2, 1);
  }
}

/* ---------------------------------------------
   Loop control
----------------------------------------------*/

/**
 * Starts the main physics simulation loop.
 *
 * @remarks
 * This function sets up a `setInterval` to run at a fixed rate (60Hz). In each
 * tick, it calculates delta time, steps the world, and then publishes the
 * resulting state snapshots and collision events to their respective shared
 * buffers.
 */
function startPhysicsLoop(): void {
  let lastTime = performance.now();
  stepInterval = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    stepWorld(dt);
    publishSnapshot();
    publishCollisionEvents();
    publishCharacterControllerEvents();
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

  // IMPORTANT: Free the EventQueue to avoid WASM memory leaks
  if (eventQueue) {
    eventQueue.free();
    eventQueue = null;
  }

  entityToBody.clear();
  entityToController.clear();
  playerOnGround.clear();
  accumulator = 0;
  stepCounter = 0;
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
      // Use centralized initialization
      await initializePhysics();

      if (!world) {
        throw new Error("Physics world creation failed");
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

      raycastResultsI32 = new Int32Array(msg.raycastResultsBuffer);
      raycastResultsF32 = new Float32Array(msg.raycastResultsBuffer);
      Atomics.store(
        raycastResultsI32,
        RAYCAST_RESULTS_MAGIC_OFFSET >> 2,
        RAYCAST_RESULTS_MAGIC,
      );
      Atomics.store(
        raycastResultsI32,
        RAYCAST_RESULTS_VERSION_OFFSET >> 2,
        RAYCAST_RESULTS_VERSION,
      );
      Atomics.store(raycastResultsI32, RAYCAST_RESULTS_GEN_OFFSET >> 2, 0);

      interactionRaycastResultsI32 = new Int32Array(
        msg.interactionRaycastResultsBuffer,
      );
      Atomics.store(
        interactionRaycastResultsI32,
        INTERACTION_RAYCAST_RESULTS_MAGIC_OFFSET >> 2,
        INTERACTION_RAYCAST_RESULTS_MAGIC,
      );
      Atomics.store(
        interactionRaycastResultsI32,
        INTERACTION_RAYCAST_RESULTS_VERSION_OFFSET >> 2,
        INTERACTION_RAYCAST_RESULTS_VERSION,
      );
      Atomics.store(
        interactionRaycastResultsI32,
        INTERACTION_RAYCAST_RESULTS_GEN_OFFSET >> 2,
        0,
      );

      collisionEventsI32 = new Int32Array(msg.collisionEventsBuffer);
      collisionEventsF32 = new Float32Array(msg.collisionEventsBuffer);
      Atomics.store(
        collisionEventsI32,
        COLLISION_EVENTS_MAGIC_OFFSET >> 2,
        COLLISION_EVENTS_MAGIC,
      );
      Atomics.store(
        collisionEventsI32,
        COLLISION_EVENTS_VERSION_OFFSET >> 2,
        COLLISION_EVENTS_VERSION,
      );
      Atomics.store(collisionEventsI32, COLLISION_EVENTS_HEAD_OFFSET >> 2, 0);
      Atomics.store(collisionEventsI32, COLLISION_EVENTS_TAIL_OFFSET >> 2, 0);
      Atomics.store(collisionEventsI32, COLLISION_EVENTS_GEN_OFFSET >> 2, 0);

      charControllerEventsI32 = new Int32Array(msg.charControllerEventsBuffer);
      charControllerEventsF32 = new Float32Array(
        msg.charControllerEventsBuffer,
      );
      Atomics.store(
        charControllerEventsI32,
        CHAR_CONTROLLER_EVENTS_MAGIC_OFFSET >> 2,
        CHAR_CONTROLLER_EVENTS_MAGIC,
      );
      Atomics.store(
        charControllerEventsI32,
        CHAR_CONTROLLER_EVENTS_VERSION_OFFSET >> 2,
        CHAR_CONTROLLER_EVENTS_VERSION,
      );
      Atomics.store(
        charControllerEventsI32,
        CHAR_CONTROLLER_EVENTS_HEAD_OFFSET >> 2,
        0,
      );
      Atomics.store(
        charControllerEventsI32,
        CHAR_CONTROLLER_EVENTS_TAIL_OFFSET >> 2,
        0,
      );
      Atomics.store(
        charControllerEventsI32,
        CHAR_CONTROLLER_EVENTS_GEN_OFFSET >> 2,
        0,
      );

      startPhysicsLoop();
      postMessage({ type: "READY" } as PhysicsReadyMsg);
    } catch (e) {
      const error = e as Error;
      console.error("[PhysicsWorker] Init failed:", error);
      postMessage({ type: "ERROR", error: String(error?.message) });
    }
    return;
  }

  if (!world) return;

  switch (msg.type) {
    case "STEP": {
      if (!world) return;

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

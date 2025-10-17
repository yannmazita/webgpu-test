// src/app/physicsWorker/events.ts
import { state } from "@/app/physicsWorker/state";
import { processCommands } from "@/app/physicsWorker/commands";
import { publishSnapshot } from "@/app/physicsWorker/snapshot";
import {
  publishCollisionEvents,
  publishCharacterControllerEvents,
} from "@/app/physicsWorker/events";

const FIXED_DT = 1 / 60;

/**
 * Advances the physics simulation by one or more fixed time steps.
 *
 * Uses an accumulator to ensure consistent simulation rate regardless
 * of frame rate variations.
 *
 * @remarks
 * Processes commands before each world step.
 * Updates performance metrics after completing all steps.
 *
 * @param dt - Delta time in seconds since the last call
 */
export function stepWorld(dt: number): void {
  if (!state.world || !state.eventQueue) return;

  state.accumulator += dt;
  const stepStart = performance.now();

  while (state.accumulator >= FIXED_DT) {
    processCommands();
    state.world.step(state.eventQueue);
    state.accumulator -= FIXED_DT;
    state.stepCounter++;
  }

  state.lastStepTimeMs = performance.now() - stepStart;
}

/**
 * Starts the fixed-rate physics simulation loop.
 *
 * Runs at 60Hz using setInterval, processing commands, stepping the world,
 * and publishing snapshots and events each tick.
 *
 * @remarks
 * The loop continues until stopPhysicsLoop() is called.
 * Time is measured using performance.now() for accuracy.
 */
export function startPhysicsLoop(): void {
  let lastTime = performance.now();
  state.stepInterval = setInterval(() => {
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

/**
 * Stops the physics loop and cleans up all resources.
 *
 * Removes all bodies and controllers from the world, frees the world
 * and event queue, and resets all state to initial values.
 *
 * @remarks
 * Must be called before worker termination to prevent memory leaks.
 * Clears all entity mappings and resets the accumulator.
 */
export function stopPhysicsLoop(): void {
  if (state.stepInterval != null) {
    clearInterval(state.stepInterval);
    state.stepInterval = null;
  }
  if (state.world) {
    state.entityToBody.forEach((body, physId) => {
      const controller = state.entityToController.get(physId);
      if (controller) state.world?.removeCharacterController(controller);
      state.world?.removeRigidBody(body);
    });
    state.world.free();
    state.world = null;
  }

  if (state.eventQueue) {
    state.eventQueue.free();
    state.eventQueue = null;
  }

  state.entityToBody.clear();
  state.entityToController.clear();
  state.playerOnGround.clear();
  state.accumulator = 0;
  state.stepCounter = 0;
  console.log("[PhysicsWorker] Loop stopped and resources freed.");
}

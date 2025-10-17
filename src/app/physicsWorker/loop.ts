// src/app/physicsWorker/events.ts
import { state } from "@/app/physicsWorker/state";
import { processCommands } from "@/app/physicsWorker/commands";
import { publishSnapshot } from "@/app/physicsWorker/snapshot";
import {
  publishCollisionEvents,
  publishCharacterControllerEvents,
} from "@/app/physicsWorker/events";

const FIXED_DT = 1 / 60;

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

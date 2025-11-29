// src/server/physics/physicsHost.ts
import { Worker } from "worker_threads";
import { resolve } from "path";
import {
  PhysicsContext,
  createPhysicsContext,
  initializePhysicsHeaders,
} from "@/shared/state/physicsState";
import {
  COMMANDS_BUFFER_SIZE,
  STATES_BUFFER_SIZE,
  COLLISION_EVENTS_BUFFER_SIZE,
  CHAR_CONTROLLER_EVENTS_BUFFER_SIZE,
  RAYCAST_RESULTS_BUFFER_SIZE,
  INTERACTION_RAYCAST_RESULTS_BUFFER_SIZE,
} from "@/shared/state/sharedPhysicsLayout";
import { PhysicsInitMsg } from "@/shared/types/physics";

/**
 * This helper handles the complexity of setting up the physics thread in Node.js.
 */
export class PhysicsHost {
  public worker: Worker;
  public context: PhysicsContext;

  // buffers
  private commandsBuffer: SharedArrayBuffer;
  private statesBuffer: SharedArrayBuffer;
  private collisionEventsBuffer: SharedArrayBuffer;
  private charControllerEventsBuffer: SharedArrayBuffer;
  private raycastResultsBuffer: SharedArrayBuffer;
  private interactionRaycastResultsBuffer: SharedArrayBuffer;

  constructor() {
    // 1. Allocate Shared Memory
    this.commandsBuffer = new SharedArrayBuffer(COMMANDS_BUFFER_SIZE);
    this.statesBuffer = new SharedArrayBuffer(STATES_BUFFER_SIZE);
    this.collisionEventsBuffer = new SharedArrayBuffer(COLLISION_EVENTS_BUFFER_SIZE);
    this.charControllerEventsBuffer = new SharedArrayBuffer(CHAR_CONTROLLER_EVENTS_BUFFER_SIZE);
    this.raycastResultsBuffer = new SharedArrayBuffer(RAYCAST_RESULTS_BUFFER_SIZE);
    this.interactionRaycastResultsBuffer = new SharedArrayBuffer(INTERACTION_RAYCAST_RESULTS_BUFFER_SIZE);

    // 2. Initialize Context Wrappers (Int32/Float32 views)
    this.context = createPhysicsContext(
      this.commandsBuffer,
      this.statesBuffer,
      this.collisionEventsBuffer,
      this.charControllerEventsBuffer
    );

    // 3. Initialize Headers (Magic numbers, versioning)
    initializePhysicsHeaders(this.context);

    // 4. Spawn Worker Thread
    // Note: We point to the compiled JS output of the worker.
    // In a TS-Node dev environment, might need a different path or a loader.
    // the build process should output to dist/server/physics/physicsWorker.js
    // I didn't update this
    const workerPath = resolve(__dirname, "../physics/physicsWorker.js");
    
    this.worker = new Worker(workerPath);

    this.worker.on("error", (err) => {
      console.error("[PhysicsHost] Worker error:", err);
    });

    this.worker.on("exit", (code) => {
      if (code !== 0) console.error(`[PhysicsHost] Worker stopped with exit code ${code}`);
    });

    this.worker.on("message", (msg) => {
        if (msg.type === 'READY') {
            console.log("[PhysicsHost] Physics worker ready.");
        }
    });

    // 5. Send Init Message
    const initMsg: PhysicsInitMsg = {
      type: "INIT",
      commandsBuffer: this.commandsBuffer,
      statesBuffer: this.statesBuffer,
      raycastResultsBuffer: this.raycastResultsBuffer,
      collisionEventsBuffer: this.collisionEventsBuffer,
      interactionRaycastResultsBuffer: this.interactionRaycastResultsBuffer,
      charControllerEventsBuffer: this.charControllerEventsBuffer,
    };

    this.worker.postMessage(initMsg);
  }

  public async terminate() {
    this.worker.postMessage({ type: "DESTROY" });
    await this.worker.terminate();
  }
}

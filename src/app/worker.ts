// src/app/worker.ts
/// <reference lib="webworker" />

import {
  InitMsg,
  ResizeMsg,
  FrameMsg,
  ToneMapMsg,
  SetEnvironmentMsg,
  RaycastRequestMsg,
  MSG_INIT,
  MSG_RESIZE,
  MSG_FRAME,
  MSG_SET_TONE_MAPPING,
  MSG_SET_ENVIRONMENT,
  MSG_RAYCAST_REQUEST,
} from "@/core/types/worker";

import { state } from "@/app/worker/state";
import { initWorker } from "@/app/worker/init";
import { frame } from "@/app/worker/loop";
import { applyPhysicsSnapshot } from "@/app/worker/physics";
import { handleRaycastRequest } from "@/app/worker/raycast";
import {
  handleResize,
  handleToneMappingChange,
  handleEnvironmentChange,
} from "@/app/worker/systems";

/**
 * Main render worker entry point.
 *
 * @remarks
 * This worker handles the core rendering loop, ECS systems, input processing,
 * and shared state synchronization with the main and physics threads. It receives
 * messages from the main thread and orchestrates all game logic and rendering.
 *
 * Key responsibilities:
 * - Initialize WebGPU renderer and ECS world
 * - Execute game loop with strict system ordering
 * - Synchronize state with physics worker via SharedArrayBuffers
 * - Handle resize, tone mapping, and environment changes
 * - Process raycast requests from the main thread
 *
 * Assumptions:
 * - OffscreenCanvas is transferred from main thread
 * - COOP/COEP headers enabled for SharedArrayBuffer support
 * - No direct DOM access
 */

/**
 * Message event handler for the worker.
 *
 * @remarks
 * Dispatches incoming messages from the main thread:
 * - INIT: Complete worker setup
 * - RESIZE: Update canvas dimensions
 * - FRAME: Execute one frame
 * - SET_TONE_MAPPING: Toggle post-processing
 * - SET_ENVIRONMENT: Load new HDR environment
 * - RAYCAST_REQUEST: Perform screen-space raycast
 *
 * @param ev - MessageEvent containing the typed payload
 */
self.onmessage = async (
  ev: MessageEvent<
    | InitMsg
    | ResizeMsg
    | FrameMsg
    | ToneMapMsg
    | SetEnvironmentMsg
    | RaycastRequestMsg
  >,
) => {
  const msg = ev.data;

  // Handle initialization
  if (msg.type === MSG_INIT) {
    await initWorker(
      msg.canvas,
      msg.sharedInputBuffer,
      msg.sharedEngineStateBuffer,
      msg.sharedRaycastResultsBuffer,
      msg.sharedInteractionRaycastResultsBuffer,
      msg.sharedCollisionEventsBuffer,
      msg.sharedCharControllerEventsBuffer,
    );
    return;
  }

  // Guard for uninitialized systems
  if (!state.renderer || !state.world) {
    if (msg.type === MSG_FRAME) {
      self.postMessage({ type: "FRAME_DONE" });
    }
    return;
  }

  // Handle runtime messages
  switch (msg.type) {
    case MSG_RESIZE: {
      handleResize(msg.cssWidth, msg.cssHeight, msg.devicePixelRatio);
      break;
    }
    case MSG_FRAME: {
      // If the worker is busy with an async task, skip the frame.
      if (state.isBusy) {
        self.postMessage({ type: "FRAME_DONE" });
        return;
      }
      // Apply physics snapshot before frame
      if (state.physicsCtx) {
        applyPhysicsSnapshot(state.world, state.physicsCtx);
      }
      frame(msg.now);
      break;
    }
    case MSG_SET_TONE_MAPPING: {
      handleToneMappingChange(msg.enabled);
      break;
    }
    case MSG_SET_ENVIRONMENT: {
      state.isBusy = true; // set the busy flag before starting the async operation
      try {
        await handleEnvironmentChange(msg.url, msg.size);
      } catch (e) {
        console.error("Failed to handle environment change:", e);
      } finally {
        state.isBusy = false;
      }
      break;
    }
    case MSG_RAYCAST_REQUEST: {
      handleRaycastRequest(msg.x, msg.y);
      break;
    }
  }
};

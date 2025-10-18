// src/app/worker/loop.ts
import { state } from "@/app/worker/state";
import { cameraSystem } from "@/core/ecs/systems/cameraSystem";
import { transformSystem } from "@/core/ecs/systems/transformSystem";
import { renderSystem } from "@/core/ecs/systems/renderSystem";
import { animationSystem } from "@/core/ecs/systems/animationSystem";
import { lifetimeSystem } from "@/core/ecs/systems/lifetimeSystem";
import { cameraFollowSystem } from "@/core/ecs/systems/cameraFollowSystem";
import { playerInputSystem } from "@/core/ecs/systems/playerInputSystem";
import { syncEngineState } from "@/core/engineState";
import { publishMetrics } from "@/core/metrics";
import { updatePreviousActionState } from "@/core/input/action";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { STATES_PHYSICS_STEP_TIME_MS_OFFSET } from "@/core/sharedPhysicsLayout";

/**
 * Executes one frame of the game loop.
 *
 * @remarks
 * The execution order is critical for data consistency:
 * 1. Sync state from editor and apply physics snapshot
 * 2. Handle input and camera mode toggling
 * 3. Update controllers and process input events
 * 4. Run gameplay systems (weapons, damage, etc.)
 * 5. Process all queued events
 * 6. Update core ECS systems (animation, transforms)
 * 7. Render the scene
 * 8. Publish performance metrics
 *
 * @param now - Current high-resolution timestamp from requestAnimationFrame
 */
export function frame(now: number): void {
  // Guard clause for uninitialized systems
  if (
    !state.renderer ||
    !state.world ||
    !state.sceneRenderData ||
    !state.cameraControllerSystem ||
    !state.actionController ||
    !state.playerControllerSystem ||
    !state.damageSystem ||
    !state.collisionEventSystem ||
    !state.deathSystem ||
    !state.eventManager ||
    !state.actionMap ||
    !state.interactionSystem ||
    !state.pickupSystem ||
    !state.inventorySystem ||
    !state.respawnSystem ||
    !state.particleSystem ||
    !state.particleSubsystem
  ) {
    self.postMessage({ type: "FRAME_DONE" });
    return;
  }

  // Sync editor state
  if (state.engineStateCtx) {
    syncEngineState(state.world, state.engineStateCtx);
  }

  // Calculate delta time with pause protection
  const MAX_PAUSE_SECONDS = 0.5;
  let dt = state.lastFrameTime ? (now - state.lastFrameTime) / 1000 : 0;
  state.lastFrameTime = now;
  if (dt > MAX_PAUSE_SECONDS) {
    dt = MAX_PAUSE_SECONDS;
  }

  // Handle camera mode toggle
  if (state.actionController.wasPressed("toggle_camera_mode")) {
    state.isFreeCameraActive = !state.isFreeCameraActive;
    if (state.isFreeCameraActive) {
      const cameraTransform = state.world.getComponent(
        state.cameraEntity,
        TransformComponent,
      );
      if (cameraTransform) {
        state.cameraControllerSystem.syncFromTransform(cameraTransform);
      }
    }
  }

  // Update active controller
  if (state.isFreeCameraActive) {
    state.cameraControllerSystem.update(state.world, dt);
  } else {
    state.playerControllerSystem.update(state.world, dt);
  }

  // Process input events
  playerInputSystem(state.world, state.actionController, state.eventManager);

  // Apply physics snapshot (handled in physics.ts)
  // This is called from the main frame function

  // Update gameplay systems
  state.interactionSystem.update();
  state.weaponSystem?.update(dt);
  state.projectileSystem?.update();
  lifetimeSystem(state.world, dt);
  state.collisionEventSystem.update();
  state.damageSystem.update(state.world);
  state.respawnSystem.update(now);
  state.particleSystem.update(state.world, dt, state.particleSubsystem);

  // Process all queued events
  state.eventManager.update();

  // Update core ECS systems
  animationSystem(state.world, dt);
  transformSystem(state.world);

  // Camera follow only when not in free camera mode
  if (!state.isFreeCameraActive) {
    cameraFollowSystem(state.world);
  }

  // Update physics commands and camera
  state.physicsCommandSystem?.update(state.world);
  cameraSystem(state.world);
  renderSystem(state.world, state.renderer, state.sceneRenderData);

  // Update input state for next frame
  updatePreviousActionState(
    state.actionController,
    state.previousActionState,
    state.actionMap,
  );

  // Publish performance metrics
  if (state.metricsContext && state.renderer) {
    let physicsTimeUs = 0;
    if (state.physicsCtx) {
      const physicsTimeMs =
        state.physicsCtx.statesF32[STATES_PHYSICS_STEP_TIME_MS_OFFSET >> 2];
      physicsTimeUs = Math.round(physicsTimeMs * 1000);
    }
    publishMetrics(
      state.metricsContext,
      state.renderer.getStats(),
      dt,
      ++state.metricsFrameId,
      physicsTimeUs,
    );
  }

  self.postMessage({ type: "FRAME_DONE" });
}

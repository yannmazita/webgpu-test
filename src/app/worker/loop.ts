// src/app/worker/loop.ts
import { state } from "@/app/worker/state";
import { cameraSystem } from "@/core/ecs/systems/cameraSystem";
import { transformSystem } from "@/core/ecs/systems/transformSystem";
import { renderSystem } from "@/core/ecs/systems/render/renderSystem";
import { animationSystem } from "@/core/ecs/systems/animationSystem";
import { lifetimeSystem } from "@/core/ecs/systems/lifetimeSystem";
import { cameraFollowSystem } from "@/core/ecs/systems/cameraFollowSystem";
import { playerInputSystem } from "@/core/ecs/systems/playerInputSystem";
import { syncEngineState } from "@/core/engineState";
import { updatePreviousActionState } from "@/core/input/action";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { STATES_PHYSICS_STEP_TIME_MS_OFFSET } from "@/core/sharedPhysicsLayout";
import { uiLayoutSystem } from "@/core/ecs/systems/ui/uiLayoutSystem";
import { uiButtonStyleSystem } from "@/core/ecs/systems/ui/uiButtonStyleSystem";

/**
 * Executes one frame of the game loop.
 *
 * @remarks
 * The execution order is critical for data consistency:
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
    !state.resourceLoadingSystem ||
    !state.uiRenderSystem
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

  // --- Resource Loading ---
  state.resourceLoadingSystem.update(state.world);

  // --- Input & Controllers ---
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

  playerInputSystem(state.world, state.actionController, state.eventManager);

  // info: physics snapshot is called from the main frame function

  // --- Gameplay Systems ---
  state.interactionSystem.update();
  state.weaponSystem?.update(dt);
  state.projectileSystem?.update();
  lifetimeSystem(state.world, dt);
  state.collisionEventSystem.update();
  state.damageSystem.update(state.world);
  state.respawnSystem.update(now);

  // --- UI Systems ---
  uiLayoutSystem(
    state.world,
    state.renderer.getCanvas().width,
    state.renderer.getCanvas().height,
  );
  uiButtonStyleSystem(state.world);

  // --- Event Processing ---
  state.eventManager.update();

  // --- Core Transform & Camera Systems ---
  animationSystem(state.world, dt);
  transformSystem(state.world);
  if (!state.isFreeCameraActive) {
    cameraFollowSystem(state.world);
  }
  state.physicsCommandSystem?.update(state.world);
  cameraSystem(state.world);

  // --- Physics ---
  state.physicsCommandSystem?.update(state.world);

  // --- Rendering ---
  renderSystem(state.world, state.renderer, state.sceneRenderData);
  // UI rendering happens after the main scene render
  const commandEncoder = state.renderer.device.createCommandEncoder();
  state.uiRenderSystem.execute(
    state.world,
    commandEncoder,
    state.renderer.getContext().getCurrentTexture().createView(),
    state.renderer.getCanvas().width,
    state.renderer.getCanvas().height,
  );
  state.renderer.device.queue.submit([commandEncoder.finish()]);

  // --- Frame End ---
  // Update input state for next frame
  updatePreviousActionState(
    state.actionController,
    state.previousActionState,
    state.actionMap,
  );

  // Publish performance metrics
  if (state.renderer) {
    let physicsTimeUs = 0;
    if (state.physicsCtx) {
      const physicsTimeMs =
        state.physicsCtx.statesF32[STATES_PHYSICS_STEP_TIME_MS_OFFSET >> 2];
      physicsTimeUs = Math.round(physicsTimeMs * 1000);
    }
    // The previous block is used to get a physicsTimeMs from the physics thread,
    // however it no longer is wired to anything
    // todo: tidy up the remnants of the old metrics logic,
    // maybe with a dedicated metricsSystem
  }

  self.postMessage({ type: "FRAME_DONE" });
}

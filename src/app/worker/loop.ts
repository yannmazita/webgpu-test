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
import { uiLayoutSystem } from "@/core/ecs/systems/ui/uiLayoutSystem";
import { uiButtonStyleSystem } from "@/core/ecs/systems/ui/uiButtonStyleSystem";

/**
 * Executes one frame of the game loop for the render worker.
 *
 * @remarks
 * This function orchestrates the entire frame's logic in a specific, critical
 * order to ensure data consistency and correct rendering.
 *
 * 1.  **State Sync & Time:** Calculates delta time and syncs state from the
 *     editor.
 * 2.  **Resource Loading:** The `ResourceLoadingSystem` processes pending asset
 *     loads.
 * 3.  **Input & Controllers:** The active controller (free camera or player) is
 *     updated, and player input is translated into gameplay events.
 * 4.  **Gameplay Systems:** Core game logic such as interactions, combat,
 *     physics events, and lifecycles are processed.
 * 5.  **UI Systems:** The layout for all in-game UI elements is calculated, and
 *     button styles are updated based on interaction states.
 * 6.  **Event Processing:** The central `EventManager` dispatches all queued
 *     events to their subscribers.
 * 7.  **Core ECS Systems:** Animation and transform hierarchies are updated,
 *     preparing all objects for rendering.
 * 8.  **Rendering:** A single `GPUCommandEncoder` is created. The main 3D scene
 *     and the in-game UI are rendered into it in sequence. Finally, all
 *     commands for the frame are submitted to the GPU in a single batch.
 * 9.  **Frame End:** Input state is updated for the next frame's `wasPressed`
 *     checks, and a `FRAME_DONE` message is sent to the main thread.
 *
 * @param now - The current high-resolution timestamp from `requestAnimationFrame`.
 */
export function frame(now: number): void {
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
    !state.iblIntegrationSystem ||
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
  state.iblIntegrationSystem.update(state.world);

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

  if (state.isFreeCameraActive) {
    state.cameraControllerSystem.update(state.world, dt);
  } else {
    state.playerControllerSystem.update(state.world, dt);
  }
  playerInputSystem(state.world, state.actionController, state.eventManager);

  // --- Gameplay Systems ---
  state.interactionSystem.update();
  state.weaponSystem?.update(dt);
  state.projectileSystem?.update();
  lifetimeSystem(state.world, dt);
  state.collisionEventSystem.update();
  state.damageSystem.update(state.world);
  state.respawnSystem.update(now);

  // --- UI Systems ---
  const canvas = state.renderer.getCanvas();
  uiLayoutSystem(state.world, canvas.width, canvas.height);
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

  // --- Rendering ---
  const commandEncoder = state.renderer.device.createCommandEncoder({
    label: "WORKER_FRAME_ENCODER",
  });

  // 1. Render the main 3D scene.
  renderSystem(
    state.world,
    state.renderer,
    state.sceneRenderData,
    commandEncoder,
  );

  // 2. Render the in-game UI on top of the 3D scene.
  state.uiRenderSystem.execute(
    state.world,
    commandEncoder,
    state.renderer.getContext().getCurrentTexture().createView(),
    canvas.width,
    canvas.height,
  );

  // 3. Submit all recorded commands at once.
  state.renderer.device.queue.submit([commandEncoder.finish()]);

  // 4. Notify subsystems that the frame has been submitted.
  state.renderer.onFrameSubmitted();

  // --- Frame End ---
  updatePreviousActionState(
    state.actionController,
    state.previousActionState,
    state.actionMap,
  );

  self.postMessage({ type: "FRAME_DONE" });
}

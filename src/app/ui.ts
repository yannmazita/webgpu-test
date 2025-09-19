// src/app/ui.ts
import { EngineStateContext } from "@/core/engineState";
import { InputContext } from "@/core/input/manager";
import { MetricsContext } from "@/core/metrics";
import * as hud from "@/app/hud";
import * as editor from "@/app/editor";

/**
 * Initializes all UI components, including the HUD and the editor.
 * @param mainCanvas The main rendering canvas.
 * @param uiCanvas The canvas for the ImGui UI.
 * @param hudElement The HTMLDivElement for the HUD.
 * @param inCtx The input context.
 * @param metCtx The metrics context.
 * @param engStateCtx The engine state context.
 * @param w The render worker.
 */
export function init(
  mainCanvas: HTMLCanvasElement,
  uiCanvas: HTMLCanvasElement,
  hudElement: HTMLDivElement,
  inCtx: InputContext,
  metCtx: MetricsContext,
  engStateCtx: EngineStateContext,
  w: Worker,
): void {
  hud.init(hudElement, metCtx);
  editor.init(mainCanvas, uiCanvas, inCtx, engStateCtx, w);
}

/**
 * Initializes the GPU-dependent parts of the UI.
 */
export async function initUI(): Promise<void> {
  await editor.initGPU();
}

/**
 * Updates all UI components for the current frame.
 * @param now The current timestamp.
 */
export function tickUI(now: number): void {
  hud.update(now, editor.getPointerLockState());
  editor.update();
}

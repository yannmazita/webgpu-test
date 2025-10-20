// src/app/ui.ts
import { EngineStateContext } from "@/core/engineState";
import { InputContext } from "@/core/input/manager";
import * as editor from "@/app/editor";

/**
 * Initializes all UI components.
 * @param mainCanvas The main rendering canvas.
 * @param uiCanvas The canvas for the ImGui UI.
 * @param inCtx The input context.
 * @param engStateCtx The engine state context.
 * @param w The render worker.
 */
export function init(
  mainCanvas: HTMLCanvasElement,
  uiCanvas: HTMLCanvasElement,
  inCtx: InputContext,
  engStateCtx: EngineStateContext,
  w: Worker,
): void {
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
  editor.update();
}

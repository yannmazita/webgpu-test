// src/core/debugUI.ts
import { ImGui, ImGuiImplWeb } from "@mori2003/jsimgui";

/**
 * Initializes ImGui and the WebGPU backend.
 *
 * @param canvas The HTML canvas element to bind to.
 * @param device The GPUDevice for rendering.
 */
export async function init(
  canvas: HTMLCanvasElement,
  device: GPUDevice,
): Promise<void> {
  await ImGuiImplWeb.Init({
    canvas: canvas,
    device: device,
    backend: "webgpu",
    fontLoader: "freetype",
  });
}

/**
 * Starts a new ImGui frame. This should be called once at the beginning
 * of each animation frame, before any ImGui widgets are declared.
 */
export function beginFrame(): void {
  ImGuiImplWeb.BeginRender();
}

/**
 * Renders the ImGui draw data into the provided render pass.
 * This should be called after all ImGui widgets have been declared for
 * the frame.
 *
 * @param passEncoder The GPURenderPassEncoder for the current frame.
 */
export function render(passEncoder: GPURenderPassEncoder): void {
  ImGuiImplWeb.EndRender(passEncoder);
}

/**
 * Cleans up ImGui resources. Should be called when the application exits.
 */
export function destroy(): void {
  if (ImGui.GetCurrentContext()) {
    ImGui.DestroyContext();
  }
}

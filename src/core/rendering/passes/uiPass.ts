// src/core/rendering/passes/uiPass.ts

/**
 * A utility class for rendering UI or other overlays on top of a completed scene.
 *
 * @remarks
 * This class is not a standard `RenderPass` because it serves a special purpose.
 * Its primary function is to create a `GPURenderPass` configured with
 * `loadOp: 'load'`. This setting is crucial as it preserves the existing
 * contents of the color attachment (the rendered scene) instead of clearing it,
 * allowing the UI to be drawn directly on top.
 *
 * It acts as a simple wrapper that handles the boilerplate of beginning and
 * ending the render pass, and then delegates the actual drawing commands to a
 * callback function provided by the caller. This makes it easy to integrate
 * external UI libraries or custom debug drawing.
 */
export class UIPass {
  /**
   * Records a render pass for drawing UI.
   *
   * @remarks
   * This method begins a new render pass, sets the viewport to the full
   * canvas size, invokes the provided `callback` with the pass encoder, and
   * then immediately ends the pass.
   *
   * @param commandEncoder The `GPUCommandEncoder` for the current frame.
   * @param textureView The `GPUTextureView` to render into, typically the
   *   canvas's current texture view.
   * @param canvasWidth The physical width of the target texture view.
   * @param canvasHeight The physical height of the target texture view.
   * @param callback A function that receives the configured
   *   `GPURenderPassEncoder`. The caller is responsible for recording all UI
   *   drawing commands within this function.
   */
  public record(
    commandEncoder: GPUCommandEncoder,
    textureView: GPUTextureView,
    canvasWidth: number,
    canvasHeight: number,
    callback: (passEncoder: GPURenderPassEncoder) => void,
  ): void {
    const uiPassEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        { view: textureView, loadOp: "load", storeOp: "store" },
      ],
    });
    uiPassEncoder.setViewport(0, 0, canvasWidth, canvasHeight, 0, 1);
    callback(uiPassEncoder);
    uiPassEncoder.end();
  }
}

// src/core/rendering/passes/uiPass.ts

export class UIPass {
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

// src/main.ts
import {
  checkWebGPU,
  configureContext,
  createShaderModule,
  createRenderPipeline,
  renderFrame,
  createTriangleBuffer,
} from "@/core/utils/webgpu.ts";
import shaderCode from "@/core/shaders/shaders.wgsl";
import "@/style.css";

const adapter = await checkWebGPU();
if (!adapter) throw new Error("No GPU adapter found.");

const device = await adapter.requestDevice();
const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
const ctx = canvas?.getContext("webgpu");

if (ctx && canvas) {
  configureContext(ctx, device);

  const shaderModule = createShaderModule(device, shaderCode);
  const { buffer, layout } = createTriangleBuffer(device);
  const pipeline = createRenderPipeline(device, shaderModule, layout);

  renderFrame(device, ctx, pipeline, canvas, (passEncoder) => {
    passEncoder.setVertexBuffer(0, buffer);
  });
}

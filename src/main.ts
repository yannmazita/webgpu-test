import {
  checkWebGPU,
  configureContext,
  createShaderModule,
  createRenderPipeline,
  drawTriangle,
} from "@/core/utils/webgpu.ts";
import shaderCode from "@/core/shaders/shaders.wgsl";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <canvas id="canvas" width="640" height="480"></canvas>
`;

const adapter = await checkWebGPU();
if (!adapter) throw new Error("No GPU adapter found.");

const device = await adapter.requestDevice();
const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
const ctx = canvas?.getContext("webgpu");

if (ctx && canvas) {
  configureContext(ctx, device);

  const shaderModule = createShaderModule(device, shaderCode);
  const pipeline = createRenderPipeline(device, shaderModule);
  drawTriangle(device, ctx, pipeline, canvas);
}

// src/core/utils/webgpu.ts
export const checkWebGPU = async (): Promise<GPUAdapter | null> => {
  if (!navigator.gpu) {
    console.error("WebGPU is not available.");
    throw new Error("WebGPU support is not available");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    console.error("Couldn't request adapter.");
  }

  return adapter;
};

export const configureContext = (ctx: GPUCanvasContext, device: GPUDevice) => {
  const canvasConfig: GPUCanvasConfiguration = {
    device: device,
    format: navigator.gpu.getPreferredCanvasFormat(),
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    alphaMode: "opaque",
  };

  ctx.configure(canvasConfig);
};

export const createShaderModule = (
  device: GPUDevice,
  code: string,
): GPUShaderModule => {
  return device.createShaderModule({ code });
};

export const createRenderPipeline = (
  device: GPUDevice,
  shaderModule: GPUShaderModule,
): GPURenderPipeline => {
  return device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
};

export const drawTriangle = (
  device: GPUDevice,
  ctx: GPUCanvasContext,
  pipeline: GPURenderPipeline,
  canvas: HTMLCanvasElement,
) => {
  const textureView = ctx.getCurrentTexture().createView();

  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: textureView,
        clearValue: { r: 0, g: 1, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });

  passEncoder.setPipeline(pipeline);
  passEncoder.setViewport(0, 0, canvas.width, canvas.height, 0, 1);
  passEncoder.draw(3, 1, 0, 0);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
};

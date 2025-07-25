// src/core/utils/webgpu.ts

/**
 * Checks if WebGPU is available and requests a GPU adapter.
 *
 * @returns A GPUAdapter promise if available else null.
 * @throws If WebGPU is not supported by the browser.
 */
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

/**
 * Configures the WebGPU canvas context for rendering.
 *
 * @param ctx - The GPU canvas context to configure.
 * @param device - The GPU device used for rendering.
 */
export const configureContext = (
  ctx: GPUCanvasContext,
  device: GPUDevice,
): void => {
  const canvasConfig: GPUCanvasConfiguration = {
    device: device,
    format: navigator.gpu.getPreferredCanvasFormat(),
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    alphaMode: "opaque",
  };

  ctx.configure(canvasConfig);
};

/**
 * Creates a shader module from WGSL code.
 *
 * @param device - The GPU device used to create the shader.
 * @param code - The WGSL shader code as a string.
 * @returns A GPUShaderModule compiled from the provided code.
 */
export const createShaderModule = (
  device: GPUDevice,
  code: string,
): GPUShaderModule => {
  return device.createShaderModule({ code });
};

export const createBuffer = (
  device: GPUDevice,
): { buffer: GPUBuffer; layout: GPUVertexBufferLayout } => {
  const positions = new Float32Array([
    1.0, -1.0, 0.0, -1.0, -1.0, 0.0, 0.0, 1.0, 0.0,
  ]);

  const positionBufferDesc: GPUBufferDescriptor = {
    size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  };

  const positionBuffer = device.createBuffer(positionBufferDesc);
  new Float32Array(positionBuffer.getMappedRange()).set(positions);
  positionBuffer.unmap();

  const layout: GPUVertexBufferLayout = {
    arrayStride: 4 * 3,
    stepMode: "vertex",
    attributes: [
      {
        shaderLocation: 0,
        offset: 0,
        format: "float32x3",
      },
    ],
  };

  return { buffer: positionBuffer, layout };
};

/**
 * Creates a basic render pipeline with a given shader module.
 *
 * @param device - The GPU device used to create the pipeline.
 * @param shaderModule - The compiled shader module containing vertex and fragment entry points.
 * @returns A GPURenderPipeline configured for drawing triangles.
 */
export const createRenderPipeline = (
  device: GPUDevice,
  shaderModule: GPUShaderModule,
  vertexBufferLayout: GPUVertexBufferLayout,
): GPURenderPipeline => {
  return device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [vertexBufferLayout],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
    },
    primitive: {
      topology: "triangle-list",
      frontFace: "ccw",
      cullMode: "back",
    },
  });
};

/**
 * Draws a green triangle to the given canvas using the specified render pipeline.
 *
 * @param device - The GPU device used for drawing commands.
 * @param ctx - The GPU canvas context to render to.
 * @param pipeline - The render pipeline used for drawing.
 * @param canvas - The HTML canvas element where rendering occurs.
 */
export const renderFrame = (
  device: GPUDevice,
  ctx: GPUCanvasContext,
  pipeline: GPURenderPipeline,
  canvas: HTMLCanvasElement,
  setupPass?: (encoder: GPURenderPassEncoder) => void,
): void => {
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

  passEncoder.setViewport(0, 0, canvas.width, canvas.height, 0, 1);
  passEncoder.setPipeline(pipeline);

  setupPass?.(passEncoder); // Callback to bind buffers or uniforms
  passEncoder.draw(3, 1, 0, 0);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
};

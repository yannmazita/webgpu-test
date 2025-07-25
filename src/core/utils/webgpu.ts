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
 * Configures a WebGPU canvas context with a basic rendering setup.
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

/**
 * Creates a vertex buffer for a triforce and its associated layout.
 *
 * @param device - The GPU device used to allocate the buffer.
 * @returns An object containing the GPUBuffer, GPUVertexBufferLayout, and vertex count.
 */
export const createTriforceBuffer = (
  device: GPUDevice,
): {
  buffer: GPUBuffer;
  layout: GPUVertexBufferLayout;
  vertexCount: number;
} => {
  const positions = new Float32Array([
    // Top triangle
    0.0, 0.5, 0.0, -0.25, 0.0, 0.0, 0.25, 0.0, 0.0,

    // Bottom-left triangle
    -0.25, 0.0, 0.0, -0.5, -0.5, 0.0, 0.0, -0.5, 0.0,

    // Bottom-right triangle
    0.25, 0.0, 0.0, 0.0, -0.5, 0.0, 0.5, -0.5, 0.0,
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
    // arrayStride: sizeof(float) * 3 -> 12 bytes, size of the advancing step
    // for the buffer pointer of each vertex.
    // Vertex 0 starts at offset zero in the buffer, vertex 1 startes at the 3*4=12 th byte.
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

  return { buffer: positionBuffer, layout, vertexCount: 9 };
};

/**
 * Creates a basic render pipeline for drawing triangles using a given shader.
 *
 * @param device - The GPU device used to create the pipeline.
 * @param shaderModule - A compiled GPUShaderModule with vertex and fragment entry points.
 * @param vertexBufferLayout - The layout of the vertex buffer.
 * @returns A configured GPURenderPipeline ready for rendering.
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
 * Renders a frame using the given render pipeline and canvas context.
 *
 * @param device - The GPU device used to encode rendering commands.
 * @param ctx - The GPUCanvasContext to render to.
 * @param pipeline - The GPURenderPipeline used for rendering.
 * @param canvas - The target HTML canvas element.
 * @param vertexCount - The number of vertices to draw.
 * @param setupPass - Optional callback to bind additional resources (buffers, uniforms...) to the render pass encoder.
 */
export const renderFrame = (
  device: GPUDevice,
  ctx: GPUCanvasContext,
  pipeline: GPURenderPipeline,
  canvas: HTMLCanvasElement,
  vertexCount: number,
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

  setupPass?.(passEncoder); // Allow external setup logic to bind resources
  passEncoder.draw(vertexCount, 1, 0, 0);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
};

// src/features/triforce/meshes/triforceMesh.ts
import { createGPUBuffer } from "@/core/utils/webgpu";
import { Mesh } from "@/core/types/gpu";

/**
 * Creates a vertex buffer for a triforce.
 *
 * @param device - The GPU device used to allocate the buffer.
 * @returns An object conforming to the Mesh interface, containing the
 *          GPUBuffer and vertex count for the triforce.
 */
export const createTriforceMesh = (device: GPUDevice): Mesh => {
  // prettier-ignore
  const vertices = new Float32Array([
    // Top triangle (red, green, blue vertices)
    // Position         Color
    0.0,  0.5, 0.0,   1.0, 0.0, 0.0,
   -0.25, 0.0, 0.0,   0.0, 1.0, 0.0,
    0.25, 0.0, 0.0,   0.0, 0.0, 1.0,

    // Bottom-left triangle (green, red, blue vertices)
    // Position         Color
   -0.25,  0.0, 0.0,   0.0, 1.0, 0.0,
   -0.5, -0.5, 0.0,   1.0, 0.0, 0.0,
    0.0, -0.5, 0.0,   0.0, 0.0, 1.0,

    // Bottom-right triangle (blue, green, red vertices)
    // Position         Color
    0.25,  0.0, 0.0,   0.0, 0.0, 1.0,
    0.0, -0.5, 0.0,   0.0, 1.0, 0.0,
    0.5, -0.5, 0.0,   1.0, 0.0, 0.0,
  ]);

  const buffer = createGPUBuffer(device, vertices, GPUBufferUsage.VERTEX);

  const layout: GPUVertexBufferLayout = {
    // arrayStride: sizeof(float) * (3 pos + 3 color) = 24 bytes
    arrayStride: 4 * 6,
    stepMode: "vertex",
    attributes: [
      {
        // Position
        shaderLocation: 0,
        offset: 0,
        format: "float32x3",
      },
      {
        // Color
        shaderLocation: 1,
        offset: 4 * 3, // 12 bytes
        format: "float32x3",
      },
    ],
  };

  return { buffer, vertexCount: 9, layout };
};

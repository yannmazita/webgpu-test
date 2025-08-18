// src/features/triforce/meshes/triforceMesh.ts
import { Mesh } from "@/core/types/gpu";
import { ResourceManager } from "@/core/resourceManager";

/**
 * Creates a triforce mesh.
 *
 * @param resourceManager - The resource manager instance.
 * @returns The triforce mesh.
 */
export const createTriforceMesh = (resourceManager: ResourceManager): Mesh => {
  // prettier-ignore
  const vertices = new Float32Array([
    // Each vertex: Position (x,y,z), Color (r,g,b), Tex Coords (u,v)

    // Top triangle
    // Position          Color             Tex Coords
     0.00,  0.50, 0.0,   1.0, 1.0, 1.0,    0.5, 0.0,
    -0.25,  0.00, 0.0,   1.0, 1.0, 1.0,    0.25, 0.5,
     0.25,  0.00, 0.0,   1.0, 1.0, 1.0,    0.75, 0.5,

    // Bottom-left triangle
    // Position          Color             Tex Coords
    -0.25,  0.00, 0.0,   1.0, 1.0, 1.0,    0.25, 0.5,
    -0.50, -0.50, 0.0,   1.0, 1.0, 1.0,    0.0, 1.0,
     0.00, -0.50, 0.0,   1.0, 1.0, 1.0,    0.5, 1.0,

    // Bottom-right triangle
    // Position          Color             Tex Coords
     0.25,  0.00, 0.0,   1.0, 1.0, 1.0,    0.75, 0.5,
     0.00, -0.50, 0.0,   1.0, 1.0, 1.0,    0.5, 1.0,
     0.50, -0.50, 0.0,   1.0, 1.0, 1.0,    1.0, 1.0,
  ]);
  const MESH_KEY = "TRIFORCE_MESH";

  const layout: GPUVertexBufferLayout = {
    // arrayStride: (3 pos + 3 color + 2 uv) * 4 bytes/float = 32 bytes
    arrayStride: 4 * 8,
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
      {
        // Texture Coordinates (UV)
        shaderLocation: 2,
        offset: 4 * 6, // 24 bytes
        format: "float32x2",
      },
    ],
  };

  return resourceManager.createMesh(MESH_KEY, vertices, layout);
};

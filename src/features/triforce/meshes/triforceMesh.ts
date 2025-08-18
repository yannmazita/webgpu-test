// src/features/triforce/meshes/triforceMesh.ts
import { Mesh } from "@/core/types/gpu";
import { ResourceManager } from "@/core/resourceManager";

/**
 * Creates a triforce mesh using an index buffer.
 *
 * @param resourceManager - The resource manager instance.
 * @returns The triforce mesh.
 */
export const createTriforceMesh = (resourceManager: ResourceManager): Mesh => {
  // prettier-ignore
  const vertices = new Float32Array([
    // Each vertex: Position(x,y,z), Color(r,g,b), Tex Coords(u,v)
    //                                                           // Index
    // Position          Color             Tex Coords
     0.00,  0.50, 0.0,   1.0, 1.0, 1.0,    0.5,  0.0,   // 0
    -0.25,  0.00, 0.0,   1.0, 1.0, 1.0,    0.25, 0.5,   // 1
     0.25,  0.00, 0.0,   1.0, 1.0, 1.0,    0.75, 0.5,   // 2
    -0.50, -0.50, 0.0,   1.0, 1.0, 1.0,    0.0,  1.0,   // 3
     0.00, -0.50, 0.0,   1.0, 1.0, 1.0,    0.5,  1.0,   // 4
     0.50, -0.50, 0.0,   1.0, 1.0, 1.0,    1.0,  1.0,   // 5
  ]);

  // Define the order in which to draw the vertices to form three triangles.
  const indices = new Uint16Array([
    // Top triangle
    0, 1, 2,
    // Bottom-left triangle
    1, 3, 4,
    // Bottom-right triangle
    2, 4, 5,
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

  return resourceManager.createMesh(MESH_KEY, vertices, layout, indices);
};

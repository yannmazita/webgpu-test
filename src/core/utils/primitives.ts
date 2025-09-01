// src/core/utils/primitives.ts
import { MeshData } from "@/core/types/mesh";

export function createCubeMeshData(size = 1.0): MeshData {
  const s = size / 2;

  // prettier-ignore
  const positions = new Float32Array([
    // Front face
    -s, -s, s, s, -s, s, s, s, s, -s, s, s,
    // Back face
    -s, -s, -s, -s, s, -s, s, s, -s, s, -s, -s,
    // Top face
    -s, s, -s, -s, s, s, s, s, s, s, s, -s,
    // Bottom face
    -s, -s, -s, s, -s, -s, s, -s, s, -s, -s, s,
    // Right face
    s, -s, -s, s, s, -s, s, s, s, s, -s, s,
    // Left face
    -s, -s, -s, -s, -s, s, -s, s, s, -s, s, -s,
  ]);

  // prettier-ignore
  const normals = new Float32Array([
    // Front
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    // Back
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    // Top
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    // Bottom
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    // Right
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    // Left
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ]);

  // prettier-ignore
  const texCoords = new Float32Array([
    // Front
    0, 0, 1, 0, 1, 1, 0, 1,
    // Back
    0, 0, 1, 0, 1, 1, 0, 1,
    // Top
    0, 0, 1, 0, 1, 1, 0, 1,
    // Bottom
    0, 0, 1, 0, 1, 1, 0, 1,
    // Right
    0, 0, 1, 0, 1, 1, 0, 1,
    // Left
    0, 0, 1, 0, 1, 1, 0, 1,
  ]);

  // prettier-ignore
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, // front
    4, 5, 6, 4, 6, 7, // back
    8, 9, 10, 8, 10, 11, // top
    12, 13, 14, 12, 14, 15, // bottom
    16, 17, 18, 16, 18, 19, // right
    20, 21, 22, 20, 22, 23, // left
  ]);

  return { positions, normals, texCoords, indices };
}

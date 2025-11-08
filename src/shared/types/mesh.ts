// src/shared/types/mesh.ts

/**
 * Raw mesh data, typically produced by a model loader.
 * This data is used by the ResourceManager to create a GPU-ready Mesh object.
 */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  texCoords?: Float32Array;
  texCoords1?: Float32Array;
  tangents?: Float32Array;
}

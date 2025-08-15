// src/core/types/gpu.ts
import { Mat4 } from "wgpu-matrix";
import { Material } from "../material";

/**
 * A union of all possible TypedArray constructors that can be used for GPU
 * buffers.
 */
export type TypedArray =
  | Float32Array
  | Uint32Array
  | Uint16Array
  | Int32Array
  | Int16Array
  | Int8Array
  | Uint8Array;

/**
 * Represents a renderable object with its GPU buffer and metadata.
 */
export interface Mesh {
  buffer: GPUBuffer;
  vertexCount: number;
  layout: GPUVertexBufferLayout;
}

/**
 * Represents an object in the scene, combining static mesh data with a
 * dynamic transformation matrix.
 */
export interface Renderable {
  mesh: Mesh;
  modelMatrix: Mat4;
  material: Material;
}

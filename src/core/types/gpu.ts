// src/core/types/gpu.ts

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

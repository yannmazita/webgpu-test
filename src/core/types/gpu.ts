// src/core/types/gpu.ts
import { Mat4 } from "wgpu-matrix";

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
  /** One GPU buffer for each vertex attribute (positions, normals). */
  buffers: GPUBuffer[];
  /** The layout descriptions for each buffer in the buffers array. */
  layouts: GPUVertexBufferLayout[];
  vertexCount: number;
  indexBuffer?: GPUBuffer;
  indexFormat?: GPUIndexFormat;
  indexCount?: number;
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

/**
 * Represents the material properties of a renderable object, encapsulating
 * GPU resources like textures, samplers, and their corresponding bind group.
 */
export interface Material {
  /** The material diffuse texture. Can be a dummy 1x1 texture for solid colors. */
  texture: GPUTexture;
  /** The sampler for the texture. */
  sampler: GPUSampler;
  /** A buffer containing uniform data like baseColor and flags (see shader). */
  uniformBuffer: GPUBuffer;
  /** The bind group that makes the material resources available to shaders. */
  bindGroup: GPUBindGroup;
}

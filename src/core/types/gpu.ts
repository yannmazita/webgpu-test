// src/core/types/gpu.ts
import { Mat4, Vec3 } from "wgpu-matrix";

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
 * Options for creating a Phong material.
 * All properties are optional, with sensible defaults.
 */
export interface PhongMaterialOptions {
  /** The base color of the material, also acts as a tint for the texture. Defaults to white. */
  baseColor?: [number, number, number, number];
  /** The color of the specular highlight. Defaults to white. */
  specularColor?: [number, number, number];
  /** Controls the size and intensity of the highlight. Higher is smaller/sharper. Defaults to 32. */
  shininess?: number;
  /** Optional URL for a diffuse texture map. */
  textureUrl?: string;
}

/**
 * Represents a point light source in the scene.
 */
export interface Light {
  position: Vec3;
  color: Vec3;
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

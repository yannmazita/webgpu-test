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
  /**
   * The base RGBA color of the material. Each component should be in the
   * normalized [0.0, 1.0] range. This color acts as a tint when a texture
   * is present. default: [1, 1, 1, 1] (white)
   */
  baseColor?: [number, number, number, number];

  /**
   * The RGB color of the specular highlight. Each component should be in the
   * normalized [0.0, 1.0] range. default: [1, 1, 1] (white)
   */
  specularColor?: [number, number, number];

  /**
   * The shininess factor, which controls the size and intensity of the
   * specular highlight. It's the exponent in the Phong specular calculation.
   * Higher values result in smaller, sharper highlights (like plastic), while
   * lower values create larger, softer highlights (like rubber).
   * default: 32.0
   */
  shininess?: number;

  /**
   * An optional URL for a diffuse texture map. If provided, its color will be
   * multiplied by the `baseColor`.
   */
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
  /** Has the material alpha blending enabled. */
  isTransparent: boolean;
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

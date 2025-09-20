// src/core/types/gpu.ts
import { Mat4, Vec3, Vec4 } from "wgpu-matrix";
import { MaterialInstance } from "../materials/materialInstance";

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
 * Represents a light source in the scene.
 *
 */
export interface Light {
  /** Light position, vec4 and w=1 for padding purposes */
  position: Vec4;
  /** Light color, vec4 and w=1 for padding purposes */
  color: Vec4;
  /**
   * params0 = [range, intensity, type, pad0]
   * range: radius of effect (units)
   * intensity: scalar multiplier
   * type: 0=point, 1=directional, 2=spot (future)
   * pad0: explicit padding for 16-byte alignment
   */
  params0: Vec4;
}

/**
 * Axis-Aligned Bounding Box
 */
export interface AABB {
  min: Vec3;
  max: Vec3;
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
  /** Axis-aligned bounding box in local mesh space */
  aabb: AABB;
}

/**
 * Represents an object in the scene, combining static mesh data with a
 * dynamic transformation matrix.
 */
export interface Renderable {
  mesh: Mesh;
  modelMatrix: Mat4;
  material: MaterialInstance;
  isUniformlyScaled: boolean;
  castShadows?: boolean;
  receiveShadows?: boolean;
}

/**
 * Data for a single instance to be passed to the GPU.
 */
export interface InstanceData {
  modelMatrix: Mat4;
  isUniformlyScaled: boolean;
  /** Per-instance shadow receiving flag; packed into instance flags bitfield. */
  receiveShadows: boolean;
}

export interface PBRMaterialOptions {
  /**
   * Base color (albedo) in linear space [R, G, B, A].
   * Acts as diffuse color for dielectrics, tint for metals.
   * Default: [1, 1, 1, 1] (white)
   */
  albedo?: [number, number, number, number];

  /**
   * Metallic factor [0.0 - 1.0].
   * 0.0 = dielectric (plastic, wood, etc.)
   * 1.0 = metallic (iron, gold, etc.)
   * Default: 0.0
   */
  metallic?: number;

  /**
   * Roughness factor [0.0 - 1.0].
   * 0.0 = perfectly smooth (mirror)
   * 1.0 = completely rough (chalk)
   * Default: 0.5
   */
  roughness?: number;

  /**
   * Normal map intensity [0.0 - 2.0].
   * 1.0 = normal intensity, 0.0 = flat surface
   * Default: 1.0
   */
  normalIntensity?: number;

  /**
   * Emissive color in linear space [R, G, B].
   * Self-illuminating surfaces (screens, lights, etc.)
   * Default: [0, 0, 0] (no emission)
   */
  emissive?: [number, number, number];

  /**
   * Ambient occlusion strength [0.0 - 1.0].
   * Default: 1.0
   */
  occlusionStrength?: number;

  // Texture Maps (glTF 2.0 standard)
  /**
   * Base color (albedo) texture map URL.
   */
  albedoMap?: string;

  /**
   * Metallic-Roughness texture map URL.
   * R channel: unused
   * G channel: roughness
   * B channel: metallic
   * Standard glTF 2.0 format
   */
  metallicRoughnessMap?: string;

  /**
   * Normal map texture URL (tangent space).
   */
  normalMap?: string;

  /**
   * Emissive texture map URL.
   */
  emissiveMap?: string;

  /**
   * Ambient occlusion texture map URL.
   */
  occlusionMap?: string;

  // --- UV Set Selectors ---
  /** UV set index for the albedo map. Defaults to 0. */
  albedoUV?: number;
  /** UV set index for the metallic-roughness map. Defaults to 0. */
  metallicRoughnessUV?: number;
  /** UV set index for the normal map. Defaults to 0. */
  normalUV?: number;
  /** UV set index for the emissive map. Defaults to 0. */
  emissiveUV?: number;
  /** UV set index for the occlusion map. Defaults to 0. */
  occlusionUV?: number;

  /**
   * Scalar multiplier for the emissive contribution (KHR_materials_emissive_strength).
   * Default: 1.0
   */
  emissiveStrength?: number;
}

/**
 * Options for creating an UnlitGround material.
 * Can be configured with either a texture or a solid color.
 */
export interface UnlitGroundMaterialOptions {
  /** The URL of the texture to apply. If provided, `color` is ignored. */
  textureUrl?: string;
  /** A solid color to apply [R, G, B, A]. Used if `textureUrl` is not provided. */
  color?: [number, number, number, number];
}

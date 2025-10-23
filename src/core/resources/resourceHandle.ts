// src/core/resources/resourceHandle.ts
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Material } from "@/core/materials/material";
import { PBRMaterial } from "@/core/materials/pbrMaterial";

/**
 * An enumeration of all managed resource types.
 */
export enum ResourceType {
  Mesh,
  Material,
  MaterialTemplate,
  Sampler,
  Texture,
  EnvironmentMap,
}

/**
 * A type-safe, serializable identifier for a cached resource.
 *
 * @remarks
 * Combines a string-based key with phantom generic type T for compile-time safety.
 * The generic T represents the primary form of the resource.
 */
export class ResourceHandle<T> {
  public readonly key: string;
  public readonly type: ResourceType;
  private __phantom: T | undefined;

  private constructor(type: ResourceType, key: string) {
    this.type = type;
    this.key = key;
  }

  // === MESH HANDLES ===

  /**
   * Creates a new handle for a Mesh resource.
   * @param key The unique identifier
   */
  public static forMesh(key: string): ResourceHandle<Mesh> {
    return new ResourceHandle<Mesh>(ResourceType.Mesh, key);
  }

  /**
   * Creates a handle for a primitive mesh.
   * @param type The primitive type (cube, sphere, etc.)
   * @param params Optional parameters string
   */
  public static forPrimitiveMesh(
    type: string,
    params?: string,
  ): ResourceHandle<Mesh> {
    const key = params ? `PRIM:${type}:${params}` : `PRIM:${type}`;
    return new ResourceHandle<Mesh>(ResourceType.Mesh, key);
  }

  /**
   * Creates a handle for an OBJ mesh.
   * @param url The OBJ file URL
   */
  public static forObjMesh(url: string): ResourceHandle<Mesh> {
    return new ResourceHandle<Mesh>(ResourceType.Mesh, `OBJ:${url}`);
  }

  /**
   * Creates a handle for an STL mesh.
   * @param url The STL file URL
   */
  public static forStlMesh(url: string): ResourceHandle<Mesh> {
    return new ResourceHandle<Mesh>(ResourceType.Mesh, `STL:${url}`);
  }

  /**
   * Creates a handle for a GLTF mesh.
   * @param url The GLTF file URL
   * @param meshName The mesh name within the GLTF
   */
  public static forGltfMesh(
    url: string,
    meshName: string,
  ): ResourceHandle<Mesh> {
    return new ResourceHandle<Mesh>(
      ResourceType.Mesh,
      `GLTF:${url}#${meshName}`,
    );
  }

  // === MATERIAL HANDLES ===

  /**
   * Creates a new handle for a MaterialInstance resource.
   * @param key The unique identifier
   */
  public static forMaterial(key: string): ResourceHandle<MaterialInstance> {
    return new ResourceHandle<MaterialInstance>(ResourceType.Material, key);
  }

  /**
   * Creates a handle for a PBR material instance.
   * @param cacheKey The cache key for the material
   */
  public static forPbrMaterial(
    cacheKey: string,
  ): ResourceHandle<MaterialInstance> {
    return new ResourceHandle<MaterialInstance>(
      ResourceType.Material,
      cacheKey,
    );
  }

  /**
   * Creates a handle for an unlit ground material.
   * @param textureUrl Optional texture URL
   * @param color Optional color array
   */
  public static forUnlitGroundMaterial(
    textureUrl?: string,
    color?: number[],
  ): ResourceHandle<MaterialInstance> {
    const colorKey = color ? color.join(",") : "";
    const key = `UNLIT_GROUND_INSTANCE:${textureUrl ?? ""}:${colorKey}`;
    return new ResourceHandle<MaterialInstance>(ResourceType.Material, key);
  }

  // === MATERIAL TEMPLATE HANDLES ===

  /**
   * Creates a new handle for a Material template.
   * @param key The unique identifier
   */
  public static forMaterialTemplate(key: string): ResourceHandle<Material> {
    return new ResourceHandle<Material>(ResourceType.MaterialTemplate, key);
  }

  /**
   * Creates a handle for a PBR material template.
   * @param isTransparent Whether the template is for transparent materials
   */
  public static forPbrTemplate(
    isTransparent: boolean,
  ): ResourceHandle<PBRMaterial> {
    const key = `PBR_TEMPLATE:${isTransparent}`;
    return new ResourceHandle<PBRMaterial>(ResourceType.MaterialTemplate, key);
  }

  // === SAMPLER HANDLES ===

  /**
   * Creates a new handle for a GPUSampler resource.
   * @param key The unique identifier
   */
  public static forSampler(key: string): ResourceHandle<GPUSampler> {
    return new ResourceHandle<GPUSampler>(ResourceType.Sampler, key);
  }

  /**
   * Creates a handle for a GLTF sampler.
   * @param magFilter Magnification filter
   * @param minFilter Minification filter
   * @param wrapS U wrap mode
   * @param wrapT V wrap mode
   */
  public static forGltfSampler(
    magFilter?: number,
    minFilter?: number,
    wrapS?: number,
    wrapT?: number,
  ): ResourceHandle<GPUSampler> {
    const key = `${magFilter ?? "L"}|${minFilter ?? "L"}|${wrapS ?? "R"}|${wrapT ?? "R"}`;
    return new ResourceHandle<GPUSampler>(ResourceType.Sampler, key);
  }

  // === GENERIC METHODS ===

  /**
   * Auto-creates a handle from a cache key, inferring the type from the resource.
   * @param key The cache key
   * @param type The resource type
   */
  public static fromKey<T>(key: string, type: ResourceType): ResourceHandle<T> {
    return new ResourceHandle<T>(type, key);
  }

  /**
   * Returns a string representation for debugging.
   */
  public toString(): string {
    return `${ResourceType[this.type]}:${this.key}`;
  }
}

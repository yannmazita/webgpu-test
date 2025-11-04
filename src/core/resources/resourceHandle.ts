// src/core/resources/resourceHandle.ts
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Material } from "@/core/materials/material";
import { PBRMaterial } from "@/core/materials/pbrMaterial";
import { UITexture } from "../types/ui";

// src/core/resources/resourceHandle.ts

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
  UITexture,
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

  // === CORE HANDLE CREATION METHODS ===

  /**
   * Creates a new handle for a resource with the given type and key.
   *
   * @remarks
   * This is the primary method for creating handles. It provides full control
   * over the handle type and key format. Most specialized factory methods
   * delegate to this method.
   *
   * @param type The resource type
   * @param key The unique identifier
   */
  public static create<T>(type: ResourceType, key: string): ResourceHandle<T> {
    return new ResourceHandle<T>(type, key);
  }

  /**
   * Auto-creates a handle from a cache key, inferring the type from the resource.
   *
   * @remarks
   * This is used internally by caches for reverse lookups when the type is known.
   *
   * @param key The cache key
   * @param type The resource type
   */
  public static fromKey<T>(key: string, type: ResourceType): ResourceHandle<T> {
    return new ResourceHandle<T>(type, key);
  }

  // === MESH HANDLES ===

  /**
   * Creates a handle for a mesh resource.
   *
   * @remarks
   * This is the primary method for mesh handles. The key should follow the
   * format "TYPE:path" where TYPE is one of: PRIM, OBJ, STL, GLTF.
   * Examples: "PRIM:cube:size=2", "OBJ:model.obj", "GLTF:model.gltf#mesh".
   *
   * @param key The mesh identifier in format "TYPE:path"
   */
  public static forMesh(key: string): ResourceHandle<Mesh> {
    return new ResourceHandle<Mesh>(ResourceType.Mesh, key);
  }

  // === MATERIAL HANDLES ===

  /**
   * Creates a handle for a material resource.
   *
   * @remarks
   * Use this for both material instances and templates. The key should uniquely
   * identify the material configuration. For templates, use "TEMPLATE:name".
   * For instances, use a descriptive key or auto-generated one.
   *
   * @param key The material identifier
   */
  public static forMaterial(key: string): ResourceHandle<MaterialInstance> {
    return new ResourceHandle<MaterialInstance>(ResourceType.Material, key);
  }

  /**
   * Creates a handle for a material template.
   *
   * @remarks
   * Template keys should follow the format "TEMPLATE:name" to distinguish
   * them from material instances.
   *
   * @param key The template identifier
   */
  public static forMaterialTemplate(key: string): ResourceHandle<Material> {
    return new ResourceHandle<Material>(ResourceType.MaterialTemplate, key);
  }

  // === SAMPLER HANDLES ===

  /**
   * Creates a handle for a sampler resource.
   *
   * @remarks
   * Sampler keys should encode the sampler properties in a consistent format.
   * For GLTF samplers, use "mag|min|wrapS|wrapT" format.
   *
   * @param key The sampler identifier
   */
  public static forSampler(key: string): ResourceHandle<GPUSampler> {
    return new ResourceHandle<GPUSampler>(ResourceType.Sampler, key);
  }

  // === UI HANDLES ===

  /**
   * Creates a handle for a UI texture resource.
   * @param key The texture identifier
   */
  public static forUITexture(key: string): ResourceHandle<UITexture> {
    return new ResourceHandle<UITexture>(ResourceType.UITexture, key);
  }

  // === CONVENIENCE HELPERS ===

  /**
   * Creates a handle for a PBR material template.
   *
   * @remarks
   * It's commonly used and has a standardized format.
   *
   * @param isTransparent Whether the template is for transparent materials
   */
  public static forPbrTemplate(
    isTransparent: boolean,
  ): ResourceHandle<PBRMaterial> {
    const key = `TEMPLATE:PBR:${isTransparent ? "TRANSPARENT" : "OPAQUE"}`;
    return new ResourceHandle<PBRMaterial>(ResourceType.MaterialTemplate, key);
  }

  /**
   * Creates a handle for an unlit ground material.
   *
   * @remarks
   * This  has a specific format used by the ground material system.
   *
   * @param textureUrl Optional texture URL
   * @param color Optional color array
   */
  public static forUnlitGroundMaterial(
    textureUrl?: string,
    color?: number[],
  ): ResourceHandle<MaterialInstance> {
    const colorKey = color ? color.join(",") : "";
    const key = `UNLIT_GROUND:${textureUrl ?? ""}:${colorKey}`;
    return new ResourceHandle<MaterialInstance>(ResourceType.Material, key);
  }

  /**
   * Returns a string representation for debugging.
   */
  public toString(): string {
    return `${ResourceType[this.type]}:${this.key}`;
  }
}

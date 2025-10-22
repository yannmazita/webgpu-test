// src/core/resources/resourceHandle.ts
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Material } from "@/core/materials/material";

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

  /**
   * Creates a new handle for a Mesh resource.
   * @param key The unique identifier
   */
  public static forMesh(key: string): ResourceHandle<Mesh> {
    return new ResourceHandle<Mesh>(ResourceType.Mesh, key);
  }

  /**
   * Creates a new handle for a MaterialInstance resource.
   * @param key The unique identifier
   */
  public static forMaterial(key: string): ResourceHandle<MaterialInstance> {
    return new ResourceHandle<MaterialInstance>(ResourceType.Material, key);
  }

  /**
   * Creates a new handle for a Material template.
   * @param key The unique identifier
   */
  public static forMaterialTemplate(key: string): ResourceHandle<Material> {
    return new ResourceHandle<Material>(ResourceType.MaterialTemplate, key);
  }

  /**
   * Creates a new handle for a GPUSampler resource.
   * @param key The unique identifier
   */
  public static forSampler(key: string): ResourceHandle<GPUSampler> {
    return new ResourceHandle<GPUSampler>(ResourceType.Sampler, key);
  }

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

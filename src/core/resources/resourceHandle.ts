// src/core/resources/resourceHandle.ts
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Material } from "@/core/materials/material";

/**
 * An enumeration of all managed resource types.
 *
 * @remarks
 * Used for debugging, serialization, and type-safe handle creation.
 */
export enum ResourceType {
  Mesh,
  Material,
  Texture,
  EnvironmentMap,
}

/**
 * A type-safe, serializable identifier for a cached resource.
 *
 * @remarks
 * It combines a string-based key for uniqueness and caching with a phantom
 * generic type `T` to ensure that a handle for a Mesh cannot be accidentally
 * used to request a Material.
 *
 * The generic `T` represents the *primary* or *singular* form of the resource.
 * For example, a mesh handle uses `Mesh`, even if it might resolve to an array
 * of meshes for multi-primitive assets.
 *
 */
export class ResourceHandle<T> {
  public readonly key: string;
  public readonly type: ResourceType;
  private __phantom: T | undefined; // Enforces compile-time type safety

  private constructor(type: ResourceType, key: string) {
    this.type = type;
    this.key = key;
  }

  /**
   * Creates a new handle for a Mesh resource.
   *
   * @remarks
   * This handle represents a mesh asset, which may resolve to a single Mesh
   * or an array of Mesh objects.
   *
   * @param key - The unique string identifier for the mesh (like "PRIM:cube").
   */
  public static forMesh(key: string): ResourceHandle<Mesh> {
    return new ResourceHandle<Mesh>(ResourceType.Mesh, key);
  }

  /**
   * Creates a new handle for a MaterialInstance resource.
   * @param key - The unique string identifier for the material instance.
   */
  public static forMaterial(key: string): ResourceHandle<MaterialInstance> {
    return new ResourceHandle<MaterialInstance>(ResourceType.Material, key);
  }

  /**
   * Creates a new handle for a shared Material template.
   *
   * @remarks
   * This is distinct from a material instance, as a template is a shared
   * pipeline and shader definition, not a per-object resource.
   *
   * @param key - The unique string identifier for the material template.
   */
  public static forMaterialTemplate(key: string): ResourceHandle<Material> {
    return new ResourceHandle<Material>(ResourceType.Material, key);
  }

  /**
   * Creates a new handle for a GPUSampler resource.
   *
   * @remarks
   * Samplers are cached based on their filter and wrap mode properties.
   *
   * @param key - The unique string identifier for the sampler configuration.
   */
  public static forSampler(key: string): ResourceHandle<GPUSampler> {
    return new ResourceHandle<GPUSampler>(ResourceType.Texture, key);
  }

  /**
   * Returns a string representation for debugging.
   */
  public toString(): string {
    return `${ResourceType[this.type]}:${this.key}`;
  }
}

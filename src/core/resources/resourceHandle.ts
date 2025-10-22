// src/core/resources/resourceHandle.ts
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "@/core/materials/materialInstance";

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
 * used to request a Material. This provides compile-time safety for resource
 * lookups.
 *
 * `T` The type of the resource this handle points to.
 */
export class ResourceHandle<T> {
  /**
   * The unique string identifier for the resource.
   */
  public readonly key: string;

  /**
   * The enumerated type of the resource.
   */
  public readonly type: ResourceType;
  private __phantom: T | undefined; // Enforces compile-time type safety

  private constructor(type: ResourceType, key: string) {
    this.type = type;
    this.key = key;
  }

  /**
   * Creates a new handle for a Mesh resource.
   *
   * @param key The unique string identifier for the mesh (like "PRIM:cube").
   * @returns A new, type-safe resource handle for a Mesh.
   */
  public static forMesh(key: string): ResourceHandle<Mesh> {
    return new ResourceHandle<Mesh>(ResourceType.Mesh, key);
  }

  /**
   * Creates a new handle for a MaterialInstance resource.
   *
   * @param key The unique string identifier for the material instance.
   * @returns A new, type-safe resource handle for a MaterialInstance.
   */
  public static forMaterial(key: string): ResourceHandle<MaterialInstance> {
    return new ResourceHandle<MaterialInstance>(ResourceType.Material, key);
  }

  /**
   * Returns a string representation for debugging.
   *
   * @remarks
   * The format is "ResourceType:key", for example, "Mesh:PRIM:cube".
   *
   * @returns A string representation of the handle.
   */
  public toString(): string {
    return `${ResourceType[this.type]}:${this.key}`;
  }
}

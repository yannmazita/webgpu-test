// src/core/resources/resourceHandle.ts
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "@/core/materials/materialInstance";

/**
 * An enumeration of all managed resource types.
 * Used for debugging and potential serialization.
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
 * It combines a string-based key for uniqueness and caching with a phantom
 * generic type `T` to ensure that a handle for a Mesh cannot be accidentally
 * used to request a Material.
 *
 * @template T The type of the resource this handle points to (like Mesh, MaterialInstance).
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
   * @param key The unique string identifier for the mesh (like "PRIM:cube").
   */
  public static forMesh(key: string): ResourceHandle<Mesh> {
    return new ResourceHandle<Mesh>(ResourceType.Mesh, key);
  }

  /**
   * Creates a new handle for a MaterialInstance resource.
   * @param key The unique string identifier for the material instance.
   */
  public static forMaterial(key: string): ResourceHandle<MaterialInstance> {
    return new ResourceHandle<MaterialInstance>(ResourceType.Material, key);
  }

  /**
   * Returns a string representation for debugging.
   */
  public toString(): string {
    return `${ResourceType[this.type]}:${this.key}`;
  }
}

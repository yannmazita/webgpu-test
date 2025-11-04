// src/core/ecs/components/resources/resourceCacheComponent.ts
import { IComponent } from "@/core/ecs/component";
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { UITexture } from "@/core/types/ui";
import { IBLComponent } from "@/core/ecs/components/iblComponent";

/**
 * A container for the result of loading an IBL resource.
 */
export interface IBLData {
  skyboxMaterial: MaterialInstance;
  iblComponent: IBLComponent;
}

/**
 * Global resource cache component for storing loaded resources.
 *
 * @remarks
 * This component is added to the world as a global resource and provides
 * centralized caching for all loaded resources. It prevents duplicate loading
 * of the same resources and enables resource sharing across entities.
 * The cache automatically manages resource lifetimes through reference counting.
 */
export class ResourceCacheComponent implements IComponent {
  /** Cache of loaded meshes by handle key. Can be a single mesh or an array for multi-primitive models. */
  private loadedMeshes = new Map<string, Mesh | Mesh[]>();

  /** Cache of loaded material instances by handle key. */
  private loadedMaterials = new Map<string, MaterialInstance>();

  /** Cache of loaded UI textures by handle key. */
  private loadedUITextures = new Map<string, UITexture>();

  /** Cache of loaded IBL resources by handle key. */
  private loadedIBLs = new Map<string, IBLData>();

  /** Reference counts for resources by handle key. */
  public refCounts = new Map<string, number>();

  /**
   * Gets a mesh from the cache.
   * @param key - The cache key.
   * @returns The cached mesh or array of meshes, or undefined.
   */
  public getMesh(key: string): Mesh | Mesh[] | undefined {
    return this.loadedMeshes.get(key);
  }

  /**
   * Stores a mesh in the cache.
   * @param key - The cache key.
   * @param mesh - The mesh or array of meshes to cache.
   */
  public setMesh(key: string, mesh: Mesh | Mesh[]): void {
    this.loadedMeshes.set(key, mesh);
  }

  /**
   * Gets a material instance from the cache.
   * @param key - The cache key.
   * @returns The cached material, or undefined.
   */
  public getMaterial(key: string): MaterialInstance | undefined {
    return this.loadedMaterials.get(key);
  }

  /**
   * Stores a material instance in the cache.
   * @param key - The cache key.
   * @param material - The material to cache.
   */
  public setMaterial(key: string, material: MaterialInstance): void {
    this.loadedMaterials.set(key, material);
  }

  /**
   * Gets a UI texture from the cache.
   * @param key - The cache key.
   * @returns The cached UI texture, or undefined.
   */
  public getUITexture(key: string): UITexture | undefined {
    return this.loadedUITextures.get(key);
  }

  /**
   * Stores a UI texture in the cache.
   * @param key - The cache key.
   * @param texture - The texture to cache.
   */
  public setUITexture(key: string, texture: UITexture): void {
    this.loadedUITextures.set(key, texture);
  }

  /**
   * Gets an IBL resource from the cache.
   * @param key - The cache key.
   * @returns The cached IBL data, or undefined.
   */
  public getIBL(key: string): IBLData | undefined {
    return this.loadedIBLs.get(key);
  }

  /**
   * Stores an IBL resource in the cache.
   * @param key - The cache key.
   * @param ibl - The IBL resource to cache.
   */
  public setIBL(key: string, ibl: IBLData): void {
    this.loadedIBLs.set(key, ibl);
  }

  /**
   * Increments the reference count for a resource.
   * @param key - The cache key.
   */
  public addRef(key: string): void {
    const current = this.refCounts.get(key) ?? 0;
    this.refCounts.set(key, current + 1);
  }

  /**
   * Decrements the reference count for a resource.
   * @param key - The cache key.
   * @returns True if reference count reached 0.
   */
  public release(key: string): boolean {
    const current = this.refCounts.get(key) ?? 0;
    const newCount = Math.max(0, current - 1);
    this.refCounts.set(key, newCount);
    return newCount === 0;
  }

  /**
   * Checks if a resource is cached in any of the maps.
   * @param key - The cache key.
   * @returns True if the resource is cached.
   */
  public has(key: string): boolean {
    return (
      this.loadedMeshes.has(key) ||
      this.loadedMaterials.has(key) ||
      this.loadedUITextures.has(key) ||
      this.loadedIBLs.has(key)
    );
  }

  /**
   * Removes a resource from all caches.
   * @param key - The cache key.
   */
  public remove(key: string): void {
    this.loadedMeshes.delete(key);
    this.loadedMaterials.delete(key);
    this.loadedUITextures.delete(key);
    this.loadedIBLs.delete(key);
    this.refCounts.delete(key);
  }

  /**
   * Clears all caches and reference counts.
   */
  public clear(): void {
    this.loadedMeshes.clear();
    this.loadedMaterials.clear();
    this.loadedUITextures.clear();
    this.loadedIBLs.clear();
    this.refCounts.clear();
  }

  /**
   * Gets cache statistics for debugging.
   * @returns An object with counts for each resource type.
   */
  public getStats(): {
    meshes: number;
    materials: number;
    textures: number;
    ibls: number;
    totalRefs: number;
  } {
    return {
      meshes: this.loadedMeshes.size,
      materials: this.loadedMaterials.size,
      textures: this.loadedUITextures.size,
      ibls: this.loadedIBLs.size,
      totalRefs: Array.from(this.refCounts.values()).reduce((a, b) => a + b, 0),
    };
  }
}

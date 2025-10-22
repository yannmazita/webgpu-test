// src/core/resources/resourceCache.ts
import { Material } from "@/core/materials/material";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Mesh } from "@/core/types/gpu";
import { ResourceHandle, ResourceType } from "@/core/resources/resourceHandle";
import { PBRMaterialSpec } from "@/core/resources/resourceManager";

/**
 * A generic cache for managing engine resources.
 *
 * @remarks
 * This class provides a unified mechanism for storing, retrieving, and managing
 * the lifecycle of resources like meshes and materials. It handles both
 * forward (handle -> resource) and reverse (resource -> handle) lookups,
 * and can store optional metadata alongside each resource.
 *
 * `T` The type of the resource being cached.
 */
export class ResourceCache<T> {
  private cache = new Map<string, T | T[]>();
  private resourceToHandle = new WeakMap<T, ResourceHandle<T>>();

  // Optional metadata storage for resources
  private resourceMetadata = new WeakMap<T, unknown>();

  /**
   * Gets a resource by its handle.
   *
   * @remarks
   * This method can return either a single resource or an array of resources.
   * The handle's generic type `T` is used for type safety but does not restrict
   * the result shape.
   *
   * @param handle - The resource handle.
   * @returns The cached resource, an array of resources, or undefined.
   */
  public get(handle: ResourceHandle<T>): T | T[] | null {
    return this.cache.get(handle.key) ?? null;
  }

  /**
   * Stores a resource or an array of resources in the cache.
   *
   * @remarks
   * If an array is provided, the handle is associated with the first element
   * of the array for reverse lookups. The cache key is derived from the handle.
   *
   * @param handle - The handle for the resource.
   * @param resource - The resource or array of resources to cache.
   * @param metadata - Optional metadata to associate with the primary resource.
   */
  public set(
    handle: ResourceHandle<T>,
    resource: T | T[],
    metadata?: unknown,
  ): void {
    this.cache.set(handle.key, resource);

    const primaryResource = Array.isArray(resource) ? resource[0] : resource;
    this.resourceToHandle.set(primaryResource, handle);

    // Store metadata if provided
    if (metadata !== undefined) {
      this.resourceMetadata.set(primaryResource, metadata);
    }
  }

  /**
   * Gets a resource by its cache key.
   *
   * @remarks
   * This method can return either a single resource or an array of resources.
   *
   * @param key - The cache key.
   * @returns The cached resource, an array of resources, or undefined.
   */
  public getByKey(key: string): T | T[] | null {
    return this.cache.get(key) ?? null;
  }

  /**
   * Retrieves metadata associated with a cached resource.
   *
   * @param resource The resource object whose metadata is to be retrieved.
   * @returns The associated metadata, or undefined if none exists.
   */
  public getMetadata(resource: T): unknown {
    return this.resourceMetadata.get(resource);
  }

  /**
   * Associates metadata with an already cached resource.
   *
   * @param resource The resource object to associate metadata with.
   * @param metadata The data to associate with the resource.
   */
  public setMetadata(resource: T, metadata: unknown): void {
    this.resourceMetadata.set(resource, metadata);
  }

  /**
   * Checks if a resource exists in the cache, identified by its handle.
   *
   * @param handle The handle of the resource to check.
   * @returns True if the resource is in the cache, false otherwise.
   */
  public has(handle: ResourceHandle<T>): boolean {
    return this.cache.has(handle.key);
  }

  /**
   * Checks if a resource exists in the cache, identified by its key.
   *
   * @param key The string key of the resource to check.
   * @returns True if the resource is in the cache, false otherwise.
   */
  public hasKey(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Retrieves the handle associated with a given resource object.
   *
   * @remarks
   * This enables reverse lookups, which are useful for serialization and debugging.
   *
   * @param resource The resource object whose handle is required.
   * @returns The associated resource handle, or undefined if not found.
   */
  public getHandle(resource: T): ResourceHandle<T> | null {
    return this.resourceToHandle.get(resource) ?? null;
  }

  /**
   * Removes a resource from the cache using its handle.
   *
   * @param handle The handle of the resource to remove.
   * @returns True if a resource was found and removed, false otherwise.
   */
  public delete(handle: ResourceHandle<T>): boolean {
    const resource = this.cache.get(handle.key);
    if (resource) {
      this.resourceToHandle.delete(resource);
    }
    return this.cache.delete(handle.key);
  }

  /**
   * Clears all resources and associated handles from the cache.
   */
  public clear(): void {
    this.cache.clear();
    // WeakMap doesn't need explicit clearing
  }

  /**
   * Gets the total number of resources currently in the cache.
   */
  public get size(): number {
    return this.cache.size;
  }

  /**
   * Retrieves all resource objects currently stored in the cache.
   *
   * @returns An array of all cached resources.
   */
  public getAll(): T[] {
    return Array.from(this.cache.values());
  }

  /**
   * Retrieves all keys currently used in the cache.
   *
   * @returns An array of all cache keys.
   */
  public getAllKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Override this method in subclasses to specify the resource type.
   * @private
   */
  protected getResourceType(): unknown {
    throw new Error("getResourceType must be implemented in subclass");
  }
}

/**
 * A specialized cache for resources that are guaranteed to be single instances,
 * not arrays. This provides stricter type safety for resources like materials.
 */
export class SingleResourceCache<T> {
  private cache = new Map<string, T>();
  private resourceToHandle = new WeakMap<T, ResourceHandle<T>>();
  private resourceMetadata = new WeakMap<T, unknown>();

  /**
   * Gets a resource by its handle.
   * @param handle - The resource handle.
   * @returns The cached resource or undefined.
   */
  public get(handle: ResourceHandle<T>): T | undefined {
    return this.cache.get(handle.key);
  }

  /**
   * Gets a resource by its cache key.
   * @param key - The cache key.
   * @returns The cached resource or undefined.
   */
  public getByKey(key: string): T | undefined {
    return this.cache.get(key);
  }

  /**
   * Stores a resource in the cache.
   * @param handle - The handle for the resource.
   * @param resource - The resource to cache.
   * @param metadata - Optional metadata to associate with the resource.
   */
  public set(handle: ResourceHandle<T>, resource: T, metadata?: any): void {
    this.cache.set(handle.key, resource);
    this.resourceToHandle.set(resource, handle);

    if (metadata !== undefined) {
      this.resourceMetadata.set(resource, metadata);
    }
  }

  /**
   * Checks if a resource exists in the cache.
   * @param handle - The resource handle.
   * @returns True if the resource is cached.
   */
  public has(handle: ResourceHandle<T>): boolean {
    return this.cache.has(handle.key);
  }

  /**
   * Checks if a resource exists by cache key.
   * @param key - The cache key.
   * @returns True if the resource is cached.
   */
  public hasKey(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Gets the handle associated with a resource.
   * @param resource - The resource to look up.
   * @returns The handle or undefined.
   */
  public getHandle(resource: T): ResourceHandle<T> | undefined {
    return this.resourceToHandle.get(resource);
  }

  /**
   * Removes a resource from the cache.
   * @param handle - The handle of the resource to remove.
   * @returns True if the resource was removed.
   */
  public delete(handle: ResourceHandle<T>): boolean {
    const resource = this.cache.get(handle.key);
    if (resource) {
      this.resourceToHandle.delete(resource);
    }
    return this.cache.delete(handle.key);
  }

  /**
   * Clears all resources from the cache.
   */
  public clear(): void {
    this.cache.clear();
  }

  /**
   * Gets the number of cached resources.
   * @returns The cache size.
   */
  public get size(): number {
    return this.cache.size;
  }

  /**
   * Gets all cached resources.
   * @returns Array of cached resources.
   */
  public getAll(): T[] {
    return Array.from(this.cache.values());
  }

  /**
   * Gets all cache keys.
   * @returns Array of cache keys.
   */
  public getAllKeys(): string[] {
    return Array.from(this.cache.keys());
  }
}

export class MeshCache extends ResourceCache<Mesh> {
  protected getResourceType(): unknown {
    return ResourceType.Mesh;
  }
}

/**
 * A specialized cache for managing shared Material templates.
 */
export class MaterialTemplateCache extends SingleResourceCache<Material> {
  protected getResourceType(): unknown {
    return ResourceType.Material;
  }
}

/**
 * A specialized cache for managing GPUSampler objects.
 */
export class SamplerCache extends SingleResourceCache<GPUSampler> {
  protected getResourceType(): unknown {
    return ResourceType.Texture; // Reuse texture type for samplers
  }
}

/**
 * A specialized cache for managing MaterialInstance resources with spec tracking.
 *
 * @remarks
 * This cache includes specific functionality for tracking the PBR material
 * specifications used to create each instance, which is essential for
 * scene serialization. This cache guarantees single instances, not arrays.
 */
export class MaterialInstanceCache extends SingleResourceCache<MaterialInstance> {
  protected getResourceType(): unknown {
    return ResourceType.Material;
  }

  /**
   * Gets the PBR material specification for a material instance.
   */
  public getMaterialSpec(material: MaterialInstance): PBRMaterialSpec | null {
    return this.getMetadata(material) as PBRMaterialSpec | null;
  }

  /**
   * Sets the PBR material specification for a material instance.
   */
  public setMaterialSpec(
    material: MaterialInstance,
    spec: PBRMaterialSpec,
  ): void {
    this.setMetadata(material, spec);
  }

  private getMetadata(resource: MaterialInstance): unknown {
    // Access the private metadata map from the base class
    return (this as any).resourceMetadata.get(resource);
  }

  private setMetadata(resource: MaterialInstance, metadata: unknown): void {
    // Access the private metadata map from the base class
    (this as any).resourceMetadata.set(resource, metadata);
  }
}

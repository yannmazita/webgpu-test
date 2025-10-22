// src/core/resources/resourceCache.ts
import { Material } from "@/core/materials/material";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Mesh } from "@/core/types/gpu";
import { ResourceHandle, ResourceType } from "@/core/resources/resourceHandle";
import { PBRMaterialSpec } from "./resourceManager";

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
  private cache = new Map<string, T>();
  private resourceToHandle = new WeakMap<T, ResourceHandle<T>>();
  // Optional metadata storage for resources
  private resourceMetadata = new WeakMap<T, any>();

  /**
   * Retrieves a resource from the cache using its handle.
   *
   * @param handle The type-safe handle of the resource to retrieve.
   * @returns The cached resource, or undefined if not found.
   */
  public get(handle: ResourceHandle<T>): T | undefined {
    return this.cache.get(handle.key);
  }

  /**
   * Gets a resource by its cache key.
   * @param key The cache key
   * @returns The cached resource or undefined
   */
  public getByKey(key: string): T | undefined {
    return this.cache.get(key);
  }

  /**
   * Retrieves metadata associated with a cached resource.
   *
   * @param resource The resource object whose metadata is to be retrieved.
   * @returns The associated metadata, or undefined if none exists.
   */
  public getMetadata(resource: T): any {
    return this.resourceMetadata.get(resource);
  }

  /**
   * Associates metadata with an already cached resource.
   *
   * @param resource The resource object to associate metadata with.
   * @param metadata The data to associate with the resource.
   */
  public setMetadata(resource: T, metadata: any): void {
    this.resourceMetadata.set(resource, metadata);
  }

  /**
   * Stores a resource in the cache.
   *
   * @remarks
   * If a handle is not provided, one will be automatically generated.
   * Associates the resource with its handle for reverse lookups.
   *
   * @param key The unique string key for the resource.
   * @param resource The resource object to store.
   * @param handle An optional, pre-existing handle for the resource.
   * @param metadata Optional arbitrary data to associate with the resource.
   * @returns The handle for the newly cached resource.
   */
  public set(
    key: string,
    resource: T,
    handle?: ResourceHandle<T>,
    metadata?: any,
  ): ResourceHandle<T> {
    this.cache.set(key, resource);

    if (handle) {
      this.resourceToHandle.set(resource, handle);
      return handle;
    }

    // Auto-generate handle if not provided
    const autoHandle = new ResourceHandle<T>(this.getResourceType(), key);
    this.resourceToHandle.set(resource, autoHandle);

    // Store metadata if provided
    if (metadata !== undefined) {
      this.resourceMetadata.set(resource, metadata);
    }
    return autoHandle;
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
  public getHandle(resource: T): ResourceHandle<T> | undefined {
    return this.resourceToHandle.get(resource);
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
  protected getResourceType(): any {
    throw new Error("getResourceType must be implemented in subclass");
  }
}

/**
 * A specialized cache for managing Mesh resources.
 */
export class MeshCache extends ResourceCache<Mesh> {
  protected getResourceType(): any {
    return ResourceType.Mesh;
  }
}

/**
 * A specialized cache for managing MaterialInstance resources.
 *
 * @remarks
 * This cache includes specific functionality for tracking the PBR material
 * specifications used to create each instance, which is essential for
 * scene serialization.
 */
export class MaterialInstanceCache extends ResourceCache<MaterialInstance> {
  protected getResourceType(): any {
    return ResourceType.Material;
  }

  /**
   * Retrieves the PBR specification associated with a material instance.
   *
   * @param material The material instance to query.
   * @returns The PBRMaterialSpec used to create the instance, or undefined.
   */
  public getMaterialSpec(
    material: MaterialInstance,
  ): PBRMaterialSpec | undefined {
    return this.getMetadata(material);
  }

  /**
   * Associates a PBR specification with a material instance.
   *
   * @param material The material instance.
   * @param spec The PBRMaterialSpec to associate.
   */
  public setMaterialSpec(
    material: MaterialInstance,
    spec: PBRMaterialSpec,
  ): void {
    this.setMetadata(material, spec);
  }
}

/**
 * A specialized cache for managing shared Material templates.
 */
export class MaterialTemplateCache extends ResourceCache<Material> {
  protected getResourceType(): any {
    return ResourceType.Material;
  }
}

/**
 * A specialized cache for managing GPUSampler objects.
 */
export class SamplerCache extends ResourceCache<GPUSampler> {
  protected getResourceType(): any {
    return ResourceType.Texture; // Reuse texture type for samplers
  }
}

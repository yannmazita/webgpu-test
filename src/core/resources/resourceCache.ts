// src/core/resources/resourceCache.ts
import { Material } from "@/core/materials/material";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Mesh } from "@/core/types/gpu";
import { ResourceHandle } from "@/core/resources/resourceHandle";
import { PBRMaterial } from "../materials/pbrMaterial";

/**
 * A unified cache for managing all engine resources.
 *
 * @remarks
 * This class provides a consistent mechanism for storing, retrieving, and managing
 * the lifecycle of resources. It handles both single resources and arrays,
 * forward/reverse lookups, and optional metadata storage.
 *
 * @template T The type of the resource being cached
 */
export class ResourceCache<T> {
  private cache = new Map<string, T | T[]>();
  private resourceToHandle = new WeakMap<T, ResourceHandle<T>>();
  private resourceMetadata = new WeakMap<T, unknown>();

  /**
   * Gets a resource by its handle.
   * @param handle The resource handle
   * @returns The cached resource, array of resources, or null
   */
  public get(handle: ResourceHandle<T>): T | T[] | null {
    return this.cache.get(handle.key) ?? null;
  }

  /**
   * Gets a resource by its cache key.
   * @param key The cache key
   * @returns The cached resource, array of resources, or null
   */
  public getByKey(key: string): T | T[] | null {
    return this.cache.get(key) ?? null;
  }

  /**
   * Stores a resource or array of resources in the cache.
   * @param handle The handle for the resource
   * @param resource The resource or array to cache
   * @param metadata Optional metadata to associate
   */
  public set(
    handle: ResourceHandle<T>,
    resource: T | T[],
    metadata?: unknown,
  ): void {
    this.cache.set(handle.key, resource);

    const primaryResource = Array.isArray(resource) ? resource[0] : resource;
    this.resourceToHandle.set(primaryResource, handle);

    if (metadata !== undefined) {
      this.resourceMetadata.set(primaryResource, metadata);
    }
  }

  /**
   * Gets metadata associated with a resource.
   * @param resource The resource to query
   * @returns The metadata or undefined
   */
  public getMetadata(resource: T): unknown {
    return this.resourceMetadata.get(resource);
  }

  /**
   * Sets metadata for a resource.
   * @param resource The resource to associate metadata with
   * @param metadata The metadata to store
   */
  public setMetadata(resource: T, metadata: unknown): void {
    this.resourceMetadata.set(resource, metadata);
  }

  /**
   * Gets the handle for a resource.
   * @param resource The resource to look up
   * @returns The handle or null
   */
  public getHandle(resource: T): ResourceHandle<T> | null {
    return this.resourceToHandle.get(resource) ?? null;
  }

  /**
   * Checks if a resource exists by handle.
   * @param handle The resource handle
   * @returns True if cached
   */
  public has(handle: ResourceHandle<T>): boolean {
    return this.cache.has(handle.key);
  }

  /**
   * Checks if a resource exists by key.
   * @param key The cache key
   * @returns True if cached
   */
  public hasKey(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Removes a resource from cache.
   * @param handle The handle of the resource to remove
   * @returns True if removed
   */
  public delete(handle: ResourceHandle<T>): boolean {
    const resource = this.cache.get(handle.key);
    if (resource && !Array.isArray(resource)) {
      this.resourceToHandle.delete(resource);
    }
    return this.cache.delete(handle.key);
  }

  /**
   * Clears all resources from cache.
   */
  public clear(): void {
    this.cache.clear();
  }

  /**
   * Gets the number of cached resources.
   */
  public get size(): number {
    return this.cache.size;
  }

  /**
   * Gets all cached resources.
   * @returns Array of all resources (may contain arrays)
   */
  public getAll(): (T | T[])[] {
    return Array.from(this.cache.values());
  }

  /**
   * Gets all cache keys.
   * @returns Array of all keys
   */
  public getAllKeys(): string[] {
    return Array.from(this.cache.keys());
  }
}

// Type aliases for specific resource caches
export type MeshCache = ResourceCache<Mesh>;
export type MaterialTemplateCache = ResourceCache<Material>;
export type SamplerCache = ResourceCache<GPUSampler>;
export type MaterialInstanceCache = ResourceCache<MaterialInstance>;
export type PBRMaterialCache = ResourceCache<PBRMaterial>;

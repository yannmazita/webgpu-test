// src/core/resources/resourceCache.ts
import { ResourceHandle, ResourceType } from "@/core/resources/resourceHandle";

/**
 * A unified cache for managing single engine resources.
 *
 * @remarks
 * This class provides a consistent mechanism for storing, retrieving, and managing
 * the lifecycle of single resources. It handles forward/reverse lookups and
 * optional metadata storage directly within the cache. The resource type is
 * provided at construction time rather than through inheritance.
 *
 * `T` The type of the resource being cached
 */
export class ResourceCache<T> {
  private cache = new Map<string, { resource: T; metadata?: unknown }>();
  private resourceToKey = new WeakMap<T, string>();
  private resourceType: ResourceType;

  /**
   * Constructs a new resource cache.
   *
   * @param resourceType The type of resources this cache will manage.
   */
  constructor(resourceType: ResourceType) {
    this.resourceType = resourceType;
  }

  /**
   * Gets a resource by its handle.
   * @param handle The resource handle
   * @returns The cached resource or null
   */
  public get(handle: ResourceHandle<T>): T | null {
    const entry = this.cache.get(handle.key);
    return entry?.resource ?? null;
  }

  /**
   * Gets a resource by its cache key.
   * @param key The cache key
   * @returns The cached resource or null
   */
  public getByKey(key: string): T | null {
    const entry = this.cache.get(key);
    return entry?.resource ?? null;
  }

  /**
   * Stores a resource in the cache with optional metadata.
   * @param handle The handle for the resource
   * @param resource The resource to cache
   * @param metadata Optional metadata to associate
   */
  public set(handle: ResourceHandle<T>, resource: T, metadata?: unknown): void {
    this.cache.set(handle.key, { resource, metadata });
    this.resourceToKey.set(resource, handle.key);
  }

  /**
   * Gets metadata associated with a resource.
   * @param resource The resource to query
   * @returns The metadata or undefined
   */
  public getMetadata(resource: T): unknown {
    const key = this.resourceToKey.get(resource);
    if (!key) return undefined;
    return this.cache.get(key)?.metadata;
  }

  /**
   * Sets metadata for an already cached resource.
   * @param resource The resource to associate metadata with
   * @param metadata The metadata to store
   */
  public setMetadata(resource: T, metadata?: unknown): void {
    const key = this.resourceToKey.get(resource);
    if (!key) return;
    const entry = this.cache.get(key);
    if (entry) {
      entry.metadata = metadata;
    }
  }

  /**
   * Gets the handle for a resource.
   * @param resource The resource to look up
   * @returns The handle or null
   */
  public getHandle(resource: T): ResourceHandle<T> | null {
    const key = this.resourceToKey.get(resource);
    if (!key) return null;
    return ResourceHandle.fromKey(key, this.resourceType);
  }

  /**
   * Gets both the resource and its metadata.
   * @param handle The resource handle
   * @returns Object with resource and metadata, or null
   */
  public getWithMetadata(
    handle: ResourceHandle<T>,
  ): { resource: T; metadata?: unknown } | null {
    const entry = this.cache.get(handle.key);
    return entry ?? null;
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
    const entry = this.cache.get(handle.key);
    if (entry) {
      this.resourceToKey.delete(entry.resource);
    }
    return this.cache.delete(handle.key);
  }

  /**
   * Clears all resources from cache.
   */
  public clear(): void {
    this.cache.clear();
    this.resourceToKey = new WeakMap();
  }

  /**
   * Gets the number of cached resources.
   */
  public get size(): number {
    return this.cache.size;
  }

  /**
   * Gets all cached resources.
   * @returns Array of all resources
   */
  public getAll(): T[] {
    return Array.from(this.cache.values()).map((entry) => entry.resource);
  }

  /**
   * Gets all cache keys.
   * @returns Array of all keys
   */
  public getAllKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Gets all entries with their metadata.
   * @returns Array of entries with resource and metadata
   */
  public getAllWithMetadata(): { resource: T; metadata?: unknown }[] {
    return Array.from(this.cache.values());
  }
}

/**
 * A cache for managing arrays of resources (e.g., multi-primitive meshes).
 *
 * @template T The type of the resources in the array
 */
export class MultiResourceCache<T> {
  private cache = new Map<string, T[]>();
  private resourceToKey = new WeakMap<T, string>();
  private resourceType: ResourceType;

  /**
   * Constructs a new multi-resource cache.
   *
   * @param resourceType The type of resources this cache will manage.
   */
  constructor(resourceType: ResourceType) {
    this.resourceType = resourceType;
  }

  /**
   * Gets resources by their handle.
   * @param handle The resource handle
   * @returns The cached resource array or null
   */
  public get(handle: ResourceHandle<T>): T[] | null {
    return this.cache.get(handle.key) ?? null;
  }

  /**
   * Gets resources by their cache key.
   * @param key The cache key
   * @returns The cached resource array or null
   */
  public getByKey(key: string): T[] | null {
    return this.cache.get(key) ?? null;
  }

  /**
   * Stores an array of resources in the cache.
   * @param handle The handle for the resources
   * @param resources The array of resources to cache
   */
  public set(handle: ResourceHandle<T>, resources: T[]): void {
    this.cache.set(handle.key, resources);
    // Map each resource to the same key for reverse lookup
    resources.forEach((resource) => {
      this.resourceToKey.set(resource, handle.key);
    });
  }

  /**
   * Gets the handle for a resource that's part of an array.
   * @param resource The resource to look up
   * @returns The handle or null
   */
  public getHandle(resource: T): ResourceHandle<T> | null {
    const key = this.resourceToKey.get(resource);
    if (!key) return null;
    return ResourceHandle.fromKey(key, this.resourceType);
  }

  /**
   * Checks if resources exist by handle.
   * @param handle The resource handle
   * @returns True if cached
   */
  public has(handle: ResourceHandle<T>): boolean {
    return this.cache.has(handle.key);
  }

  /**
   * Checks if resources exist by key.
   * @param key The cache key
   * @returns True if cached
   */
  public hasKey(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Removes resources from cache.
   * @param handle The handle of the resources to remove
   * @returns True if removed
   */
  public delete(handle: ResourceHandle<T>): boolean {
    const resources = this.cache.get(handle.key);
    if (resources) {
      resources.forEach((resource) => {
        this.resourceToKey.delete(resource);
      });
    }
    return this.cache.delete(handle.key);
  }

  /**
   * Clears all resources from cache.
   */
  public clear(): void {
    this.cache.clear();
    this.resourceToKey = new WeakMap();
  }

  /**
   * Gets the number of cached resource arrays.
   */
  public get size(): number {
    return this.cache.size;
  }

  /**
   * Gets all cached resource arrays.
   * @returns Array of all resource arrays
   */
  public getAll(): T[][] {
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

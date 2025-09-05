// src/core/ecs/world.ts
import { ComponentConstructor, IComponent } from "./component";
import { Entity } from "./entity";

/**
 * The World is the container for all entities and components.
 * It manages their lifecycle and provides methods for querying.
 */
export class World {
  private entities = new Set<Entity>();
  private nextEntityId = 0;
  private recycledEntityIds: Entity[] = [];
  private globalEntity: Entity = 0;
  // Versioned query cache: each cached entry is valid only for the worldVersion it was built on
  private queryCache = new Map<string, { version: number; result: Entity[] }>();
  private worldVersion = 0;
  private uuidToEntity = new Map<string, Entity>();
  private entityToUuid = new Map<Entity, string>();

  constructor() {
    // Reserve entity 0 for global components/resources
    const e0 = this.createEntity(); // NOTE: now calls the new signature
    this.globalEntity = e0;
    if (this.globalEntity !== 0) {
      throw new Error("World initialization error: global entity is not 0.");
    }
  }

  private _generateUuid(): string {
    return crypto.randomUUID();
  }

  /**
   * Adds a global, singleton-like component to the world.
   * @param component The component instance to add.
   */
  public addResource<T extends IComponent>(component: T): void {
    this.addComponent(this.globalEntity, component);
  }

  /**
   * Gets a global, singleton-like component from the world.
   * @param componentType The type of the component to retrieve.
   */
  public getResource<T extends IComponent>(
    componentType: ComponentConstructor<T>,
  ): T | undefined {
    return this.getComponent(this.globalEntity, componentType);
  }

  // The core of the ECS: stores components in maps for fast lookups.
  // The outer map is keyed by the component's constructor (its type).
  // The inner map is keyed by the entity's ID.
  private componentStores = new Map<
    ComponentConstructor,
    Map<Entity, IComponent>
  >();

  /**
   * Creates a new entity with a unique ID.
   * @returns The newly created entity's ID.
   */
  public createEntity(uuid?: string): Entity {
    const entityId = this.recycledEntityIds.pop() ?? this.nextEntityId++;
    this.entities.add(entityId);
    this.worldVersion++;

    // Assign or generate UUID (skip for global entity 0 if desired)
    const useUuid = uuid ?? this._generateUuid();
    if (this.uuidToEntity.has(useUuid)) {
      throw new Error(
        `Duplicate UUID detected when creating entity: ${useUuid}`,
      );
    }
    this.uuidToEntity.set(useUuid, entityId);
    this.entityToUuid.set(entityId, useUuid);

    return entityId;
  }

  /**
   * Destroys an entity and removes all its associated components.
   * @param entity The ID of the entity to destroy.
   */
  public destroyEntity(entity: Entity): void {
    if (!this.entities.has(entity)) {
      console.warn(`Attempted to destroy non-existent entity: ${entity}`);
      return;
    }

    // Remove all components associated with this entity
    for (const store of this.componentStores.values()) {
      store.delete(entity);
    }

    // Remove UUID maps
    const uuid = this.entityToUuid.get(entity);
    if (uuid !== undefined) {
      this.entityToUuid.delete(entity);
      this.uuidToEntity.delete(uuid);
    }

    this.entities.delete(entity);
    this.recycledEntityIds.push(entity);
    this.worldVersion++;
  }

  /**
   * Attaches a component instance to an entity.
   * @param entity The entity to add the component to.
   * @param component The component instance to add.
   */
  public addComponent<T extends IComponent>(
    entity: Entity,
    component: T,
  ): void {
    const componentType = component.constructor as ComponentConstructor<T>;
    if (!this.componentStores.has(componentType)) {
      this.componentStores.set(componentType, new Map());
    }
    this.componentStores.get(componentType)!.set(entity, component);
    this.worldVersion++; // Invalidate caches by version bump
  }

  /**
   * Retrieves a component of a specific type for a given entity.
   * @param entity The entity to get the component from.
   * @param componentType The type (constructor) of the component to retrieve.
   * @returns The component instance, or undefined if the entity does not have it.
   */
  public getComponent<T extends IComponent>(
    entity: Entity,
    componentType: ComponentConstructor<T>,
  ): T | undefined {
    return this.componentStores.get(componentType)?.get(entity) as
      | T
      | undefined;
  }

  /**
   * Checks if an entity has a component of a specific type.
   * @param entity The entity to check.
   * @param componentType The type of the component to check for.
   * @returns True if the entity has the component, false otherwise.
   */
  public hasComponent<T extends IComponent>(
    entity: Entity,
    componentType: ComponentConstructor<T>,
  ): boolean {
    return this.componentStores.get(componentType)?.has(entity) ?? false;
  }

  /**
   * Removes a component of a specific type from an entity.
   * @param entity The entity to remove the component from.
   * @param componentType The type of the component to remove.
   */
  public removeComponent<T extends IComponent>(
    entity: Entity,
    componentType: ComponentConstructor<T>,
  ): void {
    this.componentStores.get(componentType)?.delete(entity);
    this.worldVersion++; // Invalidate caches by version bump
  }

  /**
   * Finds all entities that possess a given set of components.
   * @param componentTypes An array of component types to query for.
   * @returns An array of entity IDs that match the query.
   */
  public query(componentTypes: ComponentConstructor[]): Entity[] {
    // Generate cache key (use component constructor names)
    const cacheKey = componentTypes
      .map((t) => t.name)
      .sort()
      .join(",");

    // Versioned cache lookup: only valid if versions match
    const cached = this.queryCache.get(cacheKey);
    if (cached && cached.version === this.worldVersion) {
      return cached.result;
    }

    if (componentTypes.length === 0) {
      const result = Array.from(this.entities);
      this.queryCache.set(cacheKey, { version: this.worldVersion, result });
      return result;
    }

    // Find the smallest component store to iterate over for efficiency
    let smallestStoreSize = Infinity;
    let smallestStoreType: ComponentConstructor | undefined;

    for (const type of componentTypes) {
      const storeSize = this.componentStores.get(type)?.size ?? 0;
      if (storeSize < smallestStoreSize) {
        smallestStoreSize = storeSize;
        smallestStoreType = type;
      }
    }

    if (!smallestStoreType || smallestStoreSize === 0) {
      const result: Entity[] = [];
      this.queryCache.set(cacheKey, { version: this.worldVersion, result });
      return result;
    }

    const potentialEntities = Array.from(
      this.componentStores.get(smallestStoreType)!.keys(),
    );
    const otherComponentTypes = componentTypes.filter(
      (t) => t !== smallestStoreType,
    );

    const result = potentialEntities.filter((entity) =>
      otherComponentTypes.every((type) => this.hasComponent(entity, type)),
    );

    this.queryCache.set(cacheKey, { version: this.worldVersion, result });
    return result;
  }

  public getEntityByUuid(uuid: string): Entity | undefined {
    return this.uuidToEntity.get(uuid);
  }

  public getEntityUuid(entity: Entity): string | undefined {
    return this.entityToUuid.get(entity);
  }
}

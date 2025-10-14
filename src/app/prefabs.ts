// src/app/prefabs.ts
import { World } from "@/core/ecs/world";
import { ResourceManager } from "@/core/resources/resourceManager";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { Entity } from "@/core/ecs/entity";
import { createPlayerPrefab } from "@/app/scene2";
import { IEntityFactory } from "@/core/ecs/systems/respawnSystem";

/**
 * A function that creates a specific type of entity (a "prefab").
 * @remarks
 * It takes the necessary contexts and an initial transform, creates an entity,
 * adds all its required components, and returns the entity's ID.
 * This function can be asynchronous to allow for resource loading.
 */
export type PrefabFn = (
  world: World,
  resourceManager: ResourceManager,
  transform: TransformComponent,
) => Promise<Entity>;

/**
 * Manages the registration and creation of entity prefabs.
 * @remarks
 * This factory provides a centralized way to instantiate complex entities from
 * a string ID. It is used by systems like the `RespawnSystem` to recreate
 * entities without needing to know their specific component makeup.
 */
export class PrefabFactory implements IEntityFactory {
  private prefabs = new Map<string, PrefabFn>();

  /**
   * Creates an instance of PrefabFactory.
   * @param world The ECS world.
   * @param resourceManager The resource manager for asset loading.
   */
  constructor(
    private world: World,
    private resourceManager: ResourceManager,
  ) {}

  /**
   * Registers a prefab function under a unique ID.
   * @param prefabId The unique string identifier for the prefab.
   * @param factoryFn The function that creates the entity.
   */
  public register(prefabId: string, factoryFn: PrefabFn): void {
    if (this.prefabs.has(prefabId)) {
      console.warn(`[PrefabFactory] Overwriting prefab with ID: ${prefabId}`);
    }
    this.prefabs.set(prefabId, factoryFn);
  }

  /**
   * Creates a new entity instance from a registered prefab.
   * @param prefabId The ID of the prefab to instantiate.
   * @param transform The initial transform for the new entity.
   * @returns A promise that resolves to the new entity's ID, or rejects if
   *   the prefab ID is not found.
   */
  public async create(
    prefabId: string,
    transform: TransformComponent,
  ): Promise<Entity> {
    const factoryFn = this.prefabs.get(prefabId);
    if (!factoryFn) {
      throw new Error(
        `[PrefabFactory] Prefab with ID "${prefabId}" not found.`,
      );
    }

    return factoryFn(this.world, this.resourceManager, transform);
  }
}

/**
 * Registers all the game's prefabs with the factory.
 * @remarks
 * This function should be called once during engine initialization. It serves
 * as the single source of truth for all prefab definitions.
 * @param factory The PrefabFactory instance to register with.
 */
export function registerPrefabs(factory: PrefabFactory): void {
  factory.register("player", createPlayerPrefab);
  // todo: prefabs like enemies, power-ups etc
  // ex: factory.register("enemy_grunt", createEnemyGruntPrefab);
}

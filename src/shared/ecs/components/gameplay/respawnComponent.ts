// src/shared/ecs/components/gameplay/respawnComponent.ts
import { IComponent } from "@/shared/ecs/component.ts";

/**
 * Defines the respawn behavior for an entity.
 * @remarks
 * When an entity with this component is destroyed, the `DeathSystem` will
 * observe it and publish a `RequestRespawnEvent`. This decouples the act of
 * dying from the logic of respawning, which is handled by the `RespawnSystem`.
 */
export class RespawnComponent implements IComponent {
  /** The delay in seconds before the entity respawns after death. */
  public respawnTime: number;

  /**
   * An identifier for a function or data block that knows how to reconstruct
   * this entity (a "prefab").
   * @remarks
   * This is essential for creating a new instance upon respawn, as the original
   * entity is completely destroyed. The `RespawnSystem` will use this ID to
   * look up the correct factory function.
   */
  public prefabId: string;

  /**
   * An optional tag to link this entity to a specific group of spawn points.
   * @remarks
   * If undefined, any `SpawnPointComponent` can be used. If specified, the
   * `RespawnSystem` will only consider spawn points with a matching tag.
   */
  public spawnPointTag?: string;

  /**
   * Creates an instance of RespawnComponent.
   * @param prefabId The unique identifier for the entity's prefab.
   * @param respawnTime The time in seconds to wait before respawning.
   * @param spawnPointTag An optional tag for selecting specific spawn points.
   */
  constructor(prefabId: string, respawnTime: 5.0, spawnPointTag?: string) {
    this.prefabId = prefabId;
    this.respawnTime = respawnTime;
    this.spawnPointTag = spawnPointTag;
  }
}

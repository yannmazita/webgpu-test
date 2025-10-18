// src/core/ecs/systems/respawnSystem.ts
import { World } from "@/core/ecs/world";
import { EventManager } from "@/core/ecs/events/eventManager";
import { GameEvent } from "@/core/ecs/events/gameEvent";
import { SpawnPointComponent } from "@/core/ecs/components/spawnPointComponent";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { Entity } from "@/core/ecs/entity";

interface PendingRespawn {
  respawnAt: number; // Timestamp from performance.now()
  prefabId: string;
  spawnPointTag?: string;
}

/**
 * An interface for a generic factory that can create entities from an ID.
 * @remarks
 * This allows the core RespawnSystem to remain decoupled from the
 * application-specific prefab implementation.
 */
export interface IEntityFactory {
  create(prefabId: string, transform: TransformComponent): Promise<Entity>;
}

/**
 * Manages the respawning of entities.
 * @remarks
 * This system listens for `RequestRespawnEvent`s, which are typically fired by
 * the `DeathSystem`. It maintains a queue of pending respawns and, when a
 * timer expires, it finds a suitable `SpawnPointComponent` and uses a generic
 * `IEntityFactory` to recreate the entity.
 */
export class RespawnSystem {
  private pendingRespawns: PendingRespawn[] = [];

  /**
   * Creates an instance of RespawnSystem.
   * @param world The ECS world.
   * @param eventManager The global event manager.
   * @param entityFactory The application-specific factory for creating entities.
   */
  constructor(
    private world: World,
    private eventManager: EventManager,
    private entityFactory: IEntityFactory,
  ) {
    this.eventManager.subscribe(
      "request-respawn",
      this.onRequestRespawn.bind(this),
    );
  }

  /**
   * The listener for `RequestRespawnEvent`.
   * @param event The game event.
   */
  private onRequestRespawn(event: GameEvent): void {
    if (event.type !== "request-respawn") return;

    const { prefabId, respawnTime, spawnPointTag } = event.payload;
    const respawnAt = performance.now() + respawnTime * 1000;

    this.pendingRespawns.push({
      respawnAt,
      prefabId,
      spawnPointTag,
    });
    console.log(
      `[RespawnSystem] Queued respawn for prefab "${prefabId}" in ${respawnTime}s.`,
    );
  }

  /**
   * Finds a suitable spawn point transform.
   * @param tag An optional tag to filter spawn points.
   * @returns The TransformComponent of a chosen spawn point, or a default
   *   transform if none are found.
   */
  private findSpawnPoint(tag?: string): TransformComponent {
    const allSpawnPoints = this.world.query([
      SpawnPointComponent,
      TransformComponent,
    ]);

    let validSpawnPoints = allSpawnPoints;
    if (tag) {
      validSpawnPoints = allSpawnPoints.filter((entity) => {
        const spawnPoint = this.world.getComponent(entity, SpawnPointComponent);
        return spawnPoint?.tag === tag;
      });
    }

    if (validSpawnPoints.length > 0) {
      const randomIndex = Math.floor(Math.random() * validSpawnPoints.length);
      const chosenEntity = validSpawnPoints[randomIndex];
      return this.world.getComponent(chosenEntity, TransformComponent)!;
    }

    console.warn(
      `[RespawnSystem] No spawn point found with tag "${tag}". Using default spawn.`,
    );
    const defaultTransform = new TransformComponent();
    defaultTransform.setPosition(0, 5, 0); // Default spawn position
    return defaultTransform;
  }

  /**
   * Updates the system each frame.
   * @remarks
   * Checks the timers on all pending respawns. If a timer has expired, it
   * finds a spawn point and creates the new entity.
   * @param now The current high-resolution timestamp from `performance.now()`.
   */
  public update(now: number): void {
    if (this.pendingRespawns.length === 0) {
      return;
    }

    // Iterate backwards to safely remove items while looping
    for (let i = this.pendingRespawns.length - 1; i >= 0; i--) {
      const pending = this.pendingRespawns[i];
      if (now >= pending.respawnAt) {
        const spawnTransform = this.findSpawnPoint(pending.spawnPointTag);

        console.log(`[RespawnSystem] Respawning prefab "${pending.prefabId}".`);
        this.entityFactory // <-- CHANGED to use the injected factory
          .create(pending.prefabId, spawnTransform)
          .catch((err) => {
            console.error(`[RespawnSystem] Failed to create prefab:`, err);
          });

        // Remove from the queue
        this.pendingRespawns.splice(i, 1);
      }
    }
  }
}

// src/shared/ecs/components/gameplay/spawnPointComponent.ts
import { IComponent } from "@/shared/ecs/component";

/**
 * Marks an entity's transform as a valid location for other entities to spawn.
 * @remarks
 * This is a simple tag component used by the `RespawnSystem` to find suitable
 * locations when recreating entities. It can be placed on empty entities in a
 * scene to define spawn locations for players, enemies, or items.
 */
export class SpawnPointComponent implements IComponent {
  /**
   * An optional tag used to group spawn points.
   * @remarks
   * This allows for fine-grained control over spawning. For example, you could
   * have spawn points tagged as "team_a_spawn", "team_b_spawn", or "item_spawn",
   * and a `RespawnComponent` can target a specific group by using the same tag.
   */
  public tag?: string;

  /**
   * Creates an instance of SpawnPointComponent.
   * @param tag An optional tag for grouping spawn points.
   */
  constructor(tag?: string) {
    this.tag = tag;
  }
}

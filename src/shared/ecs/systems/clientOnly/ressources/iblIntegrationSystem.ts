// src/shared/ecs/systems/clientOnly/ressources/iblIntegrationSystem.ts
import { World } from "@/shared/ecs/world";
import { IBLResourceComponent } from "@/shared/ecs/components/resources/resourceComponents";
import { SkyboxComponent } from "@/shared/ecs/components/resources/skyboxComponent";
import { IBLComponent } from "@/shared/ecs/components/resources/iblComponent";

/**
 * System that integrates loaded IBL resources into the world's global resources.
 *
 * @remarks
 * This system acts as a bridge between the `ResourceLoadingSystem` and the
 * `renderSystem`. It queries for entities with a loaded `IBLResourceComponent`,
 * extracts the generated skybox and IBL data, and adds them as global resources
 * to the world. This allows the renderer to access them via the standard
 * `world.getResource()` API.
 *
 * The system marks processed components to avoid re-applying them every frame.
 */
export class IBLIntegrationSystem {
  /**
   * Processes all loaded IBL resources and integrates them into the world.
   * @param world - The ECS world.
   */
  public update(world: World): void {
    const query = world.query([IBLResourceComponent]);

    for (const entity of query) {
      const iblRes = world.getComponent(entity, IBLResourceComponent);
      if (
        !iblRes ||
        iblRes.loading ||
        !iblRes.iblComponent ||
        !iblRes.skyboxMaterial
      ) {
        continue;
      }

      // Check if we've already applied this IBL
      if (iblRes.metadata === "applied") {
        continue;
      }

      // Update global resources
      world.removeResource(SkyboxComponent);
      world.addResource(new SkyboxComponent(iblRes.skyboxMaterial));

      world.removeResource(IBLComponent);
      world.addResource(iblRes.iblComponent);

      // Mark as applied to avoid re-processing
      iblRes.metadata = "applied";

      console.log(`[IBLIntegrationSystem] Applied IBL from entity ${entity}`);
    }
  }
}

// src/shared/ecs/components/resources/skyboxComponent.ts
import { MaterialInstance } from "@/client/rendering/materials/materialInstance";
import { IComponent } from "@/shared/ecs/component";

/**
 * A component that holds the environment map (cubemap) for the scene's skybox.
 * It's typically added as a resource to the world.
 */
export class SkyboxComponent implements IComponent {
  public material: MaterialInstance;

  constructor(material: MaterialInstance) {
    this.material = material;
  }
}

// src/core/ecs/components/skyboxComponent.ts
import { SkyboxMaterial } from "@/core/materials/skyboxMaterial";
import { IComponent } from "../component";

/**
 * A component that holds the environment map (cubemap) for the scene's skybox.
 * It's typically added as a resource to the world.
 */
export class SkyboxComponent implements IComponent {
  public material: SkyboxMaterial;

  constructor(material: SkyboxMaterial) {
    this.material = material;
  }
}

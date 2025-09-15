// src/core/ecs/components/meshRendererComponent.ts
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Mesh } from "@/core/types/gpu";
import { IComponent } from "../component";

export class MeshRendererComponent implements IComponent {
  public mesh: Mesh;
  public material: MaterialInstance;

  // per-mesh shadow flags
  public castShadows = true;
  public receiveShadows = true;

  /**
   * Creates a mesh renderer component.
   * @param mesh The mesh to render.
   * @param material The material instance to use.
   * @param castShadows Whether this object casts shadows.
   * @param receiveShadows Whether this object receives shadows.
   */
  constructor(
    mesh: Mesh,
    material: MaterialInstance,
    castShadows = true,
    receiveShadows = true,
  ) {
    this.mesh = mesh;
    this.material = material;
    this.castShadows = castShadows;
    this.receiveShadows = receiveShadows;
  }
}

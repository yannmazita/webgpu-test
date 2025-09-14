// src/core/ecs/components/meshRendererComponent.ts
import { Material } from "@/core/materials/material";
import { Mesh } from "@/core/types/gpu";
import { IComponent } from "../component";

export class MeshRendererComponent implements IComponent {
  public mesh: Mesh;
  public material: Material;

  // per-mesh shadow flags
  public castShadows = true;
  public receiveShadows = true;

  /**
   * Creates a mesh renderer component.
   * @param mesh The mesh to render.
   * @param material The material to use.
   * @param castShadows Whether this object casts shadows.
   * @param receiveShadows Whether this object receives shadows.
   */
  constructor(
    mesh: Mesh,
    material: Material,
    castShadows = true,
    receiveShadows = true,
  ) {
    this.mesh = mesh;
    this.material = material;
    this.castShadows = castShadows;
    this.receiveShadows = receiveShadows;
  }
}

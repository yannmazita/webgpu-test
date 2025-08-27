// src/core/ecs/components/meshRendererComponent.ts
import { Material } from "@/core/materials/material";
import { Mesh } from "@/core/types/gpu";
import { IComponent } from "../component";

export class MeshRendererComponent implements IComponent {
  public mesh: Mesh;
  public material: Material;

  constructor(mesh: Mesh, material: Material) {
    this.mesh = mesh;
    this.material = material;
  }
}

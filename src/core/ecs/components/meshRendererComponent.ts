// src/core/ecs/components/meshRendererComponent.ts
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Mesh } from "@/core/types/gpu";
import { IComponent } from "../component";

export class MeshRendererComponent implements IComponent {
  public mesh: Mesh | Mesh[];
  public material: MaterialInstance;
  public materialOverrides: Map<number, MaterialInstance> | null = null;

  // per-mesh shadow flags (applies to all sub-meshes)
  public castShadows = true;
  public receiveShadows = true;

  /**
   * Creates a mesh renderer component.
   *
   * @remarks
   * This component can handle a single mesh or an array of meshes (for multi-primitive assets).
   * By default, all sub-meshes will use the primary material. Specific material overrides
   * for sub-meshes can be provided via the `materialOverrides` map.
   *
   * @param mesh The mesh or an array of meshes to render.
   * @param material The primary material instance to use.
   * @param materialOverrides Optional map of sub-mesh indices to specific materials.
   * @param castShadows Whether this object casts shadows.
   * @param receiveShadows Whether this object receives shadows.
   */
  constructor(
    mesh: Mesh | Mesh[],
    material: MaterialInstance,
    materialOverrides: Map<number, MaterialInstance> | null = null,
    castShadows = true,
    receiveShadows = true,
  ) {
    this.mesh = mesh;
    this.material = material;
    this.materialOverrides = materialOverrides;
    this.castShadows = castShadows;
    this.receiveShadows = receiveShadows;
  }

  /**
   * A helper to get all meshes as a standard array, simplifying iteration.
   * @returns An array of Mesh objects.
   */
  public getMeshes(): Mesh[] {
    return Array.isArray(this.mesh) ? this.mesh : [this.mesh];
  }

  /**
   * Gets the material for a specific sub-mesh index.
   *
   * @remarks
   * If a material override exists for the given index, it is returned.
   * Otherwise, the primary material is used.
   *
   * @param index - The index of the sub-mesh.
   * @returns The MaterialInstance to use for the sub-mesh.
   */
  public getMaterialForIndex(index: number): MaterialInstance {
    return this.materialOverrides?.get(index) ?? this.material;
  }
}

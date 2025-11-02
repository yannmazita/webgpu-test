// src/core/ecs/components/meshRendererComponent.ts
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Mesh } from "@/core/types/gpu";
import { IComponent } from "@/core/ecs/component";
import { ResourceHandle } from "@/core/resources/resourceHandle";

export class MeshRendererComponent implements IComponent {
  /** A handle to the mesh or array of meshes to render. */
  public meshHandle: ResourceHandle<Mesh | Mesh[]>;
  /** A handle to the primary material instance to use. */
  public materialHandle: ResourceHandle<MaterialInstance>;
  /** Optional map of sub-mesh indices to specific material handles. */
  public materialOverrides: Map<
    number,
    ResourceHandle<MaterialInstance>
  > | null = null;

  // per-mesh shadow flags (applies to all sub-meshes)
  public castShadows = true;
  public receiveShadows = true;

  /**
   * Creates a mesh renderer component.
   *
   * @remarks
   * This component describes what to render using handles, decoupling it from
   * the actual loaded resources. The `renderSystem` is responsible for
   * resolving these handles at runtime.
   *
   * @param meshHandle - The handle to the mesh or array of meshes to render.
   * @param materialHandle - The handle to the primary material instance to use.
   * @param materialOverrides - Optional map of sub-mesh indices to specific material handles.
   * @param castShadows - Whether this object casts shadows.
   * @param receiveShadows - Whether this object receives shadows.
   */
  constructor(
    meshHandle: ResourceHandle<Mesh | Mesh[]>,
    materialHandle: ResourceHandle<MaterialInstance>,
    materialOverrides: Map<
      number,
      ResourceHandle<MaterialInstance>
    > | null = null,
    castShadows = true,
    receiveShadows = true,
  ) {
    this.meshHandle = meshHandle;
    this.materialHandle = materialHandle;
    this.materialOverrides = materialOverrides;
    this.castShadows = castShadows;
    this.receiveShadows = receiveShadows;
  }
}

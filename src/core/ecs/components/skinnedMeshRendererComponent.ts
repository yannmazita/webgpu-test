// src/core/ecs/components/skinnedMeshRendererComponent.ts
import { Entity } from "../entity";
import { IComponent } from "./component";

/**
 * A component that marks an entity as having a deformable mesh that is influenced
 * by a skeleton.
 * @public
 */
export class SkinnedMeshRendererComponent implements IComponent {
  /**
   * The root entity of the skeleton that deforms this mesh. This entity
   * should have a `SkeletonComponent`.
   */
  public skeletonRoot: Entity;
  public skinMatricesBuffer: GPUBuffer;
  public skinMatricesBindGroup?: GPUBindGroup;

  constructor(skeletonRoot: Entity, skinMatricesBuffer: GPUBuffer) {
    this.skeletonRoot = skeletonRoot;
    this.skinMatricesBuffer = skinMatricesBuffer;
  }
}

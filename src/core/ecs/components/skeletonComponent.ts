// src/core/ecs/components/skeletonComponent.ts
import { Mat4 } from "wgpu-matrix";
import { Entity } from "../entity";
import { IComponent } from "./component";

/**
 * Represents a skeleton hierarchy for a skinned mesh.
 * @public
 */
export class SkeletonComponent implements IComponent {
  /**
   * An ordered list of entities that represent the joints (bones) of the
   * skeleton.
   */
  public joints: Entity[];

  /**
   * The inverse bind matrices for each joint in the skeleton. These matrices
   * transform vertices from model space to the local space of each joint.
   */
  public inverseBindMatrices: Mat4[];

  constructor(joints: Entity[], inverseBindMatrices: Mat4[]) {
    this.joints = joints;
    this.inverseBindMatrices = inverseBindMatrices;
  }
}

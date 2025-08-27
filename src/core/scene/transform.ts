// src/core/scene/transform.ts
import { Mat4, mat4, Quat, quat, Vec3, vec3 } from "wgpu-matrix";
import { SceneNode } from "./sceneNode";

/**
 * Manages the position, rotation, and scale of a SceneNode in 3D space.
 * It handles the calculation of local and world transformation matrices and
 * uses a dirty-checking mechanism for optimization.
 */
export class Transform {
  // Transformation properties
  public position: Vec3 = vec3.create(0, 0, 0);
  public rotation: Quat = quat.identity();
  public scale: Vec3 = vec3.create(1, 1, 1);

  // Derived matrices
  public localMatrix: Mat4 = mat4.identity();
  public worldMatrix: Mat4 = mat4.identity();

  // Dirty flag for optimization
  private _isDirty = true;

  // The SceneNode that owns this transform.
  private owner: SceneNode;

  constructor(owner: SceneNode) {
    this.owner = owner;
  }

  // --- Public API for Transformations ---

  public setPosition(p: Vec3): void;
  public setPosition(x: number, y: number, z: number): void;
  public setPosition(xOrVec: number | Vec3, y?: number, z?: number): void {
    if (typeof xOrVec === "number") {
      vec3.set(xOrVec, y!, z!, this.position);
    } else {
      vec3.copy(xOrVec, this.position);
    }
    this.makeDirty();
  }

  public setRotation(q: Quat): void {
    quat.copy(q, this.rotation);
    this.makeDirty();
  }

  public setScale(s: Vec3): void;
  public setScale(x: number, y: number, z: number): void;
  public setScale(xOrVec: number | Vec3, y?: number, z?: number): void {
    if (typeof xOrVec === "number") {
      vec3.set(xOrVec, y!, z!, this.scale);
    } else {
      vec3.copy(xOrVec, this.scale);
    }
    this.makeDirty();
  }

  public translate(v: Vec3): void;
  public translate(x: number, y: number, z: number): void;
  public translate(xOrVec: number | Vec3, y?: number, z?: number): void {
    if (typeof xOrVec === "number") {
      vec3.add(this.position, vec3.fromValues(xOrVec, y!, z!), this.position);
    } else {
      vec3.add(this.position, xOrVec, this.position);
    }
    this.makeDirty();
  }

  public rotateX(rad: number): void {
    quat.rotateX(this.rotation, rad, this.rotation);
    this.makeDirty();
  }

  public rotateY(rad: number): void {
    quat.rotateY(this.rotation, rad, this.rotation);
    this.makeDirty();
  }

  public rotateZ(rad: number): void {
    quat.rotateZ(this.rotation, rad, this.rotation);
    this.makeDirty();
  }

  // --- Core Update Logic ---

  /**
   * Marks this transform as dirty, forcing a matrix recalculation on the next update.
   * This is automatically called when a transformation method is used.
   */
  public makeDirty(): void {
    this._isDirty = true;
  }

  /**
   * Updates the world matrix of this transform and recursively updates all its children.
   * @param parentWorldMatrix The world matrix of the parent transform.
   * @param force - If true, forces a matrix recalculation even if not dirty.
   */
  public updateWorldMatrix(parentWorldMatrix?: Mat4, force = false): void {
    const needsUpdate = this._isDirty || force;

    if (needsUpdate) {
      // Recompose local matrix from position, rotation, and scale
      mat4.fromQuat(this.rotation, this.localMatrix);
      mat4.scale(this.localMatrix, this.scale, this.localMatrix);
      mat4.setTranslation(this.localMatrix, this.position, this.localMatrix);

      // Calculate world matrix
      if (parentWorldMatrix) {
        mat4.multiply(parentWorldMatrix, this.localMatrix, this.worldMatrix);
      } else {
        mat4.copy(this.localMatrix, this.worldMatrix);
      }

      // update done, we no longer dirty
      this._isDirty = false;
    }

    // Recursively update children.
    // If this transform was updated, its children must also be updated.
    for (const childNode of this.owner.children) {
      childNode.transform.updateWorldMatrix(this.worldMatrix, needsUpdate);
    }
  }
}

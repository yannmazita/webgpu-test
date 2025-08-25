// src/core/sceneNode.ts
import { Mat4, mat4, Quat, quat, Vec3, vec3 } from "wgpu-matrix";
import { Mesh, Light } from "./types/gpu";
import { Material } from "./materials/material";

export class SceneNode {
  // Transformation properties
  public position: Vec3 = vec3.create(0, 0, 0);
  public rotation: Quat = quat.identity();
  public scale: Vec3 = vec3.create(1, 1, 1);

  // Derived matrices
  public localMatrix: Mat4 = mat4.identity();
  public worldMatrix: Mat4 = mat4.identity();

  // Graph structure
  public parent: SceneNode | null = null;
  public children: SceneNode[] = [];

  // Attached components
  public mesh?: Mesh;
  public material?: Material;
  public light?: Light;

  // Dirty flag for optimization
  private _isDirty = true;

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

  // --- Graph Management ---

  public addChild(node: SceneNode): void {
    if (node.parent) {
      node.parent.removeChild(node);
    }
    node.parent = this;
    this.children.push(node);
  }

  public removeChild(node: SceneNode): void {
    const index = this.children.indexOf(node);
    if (index > -1) {
      node.parent = null;
      this.children.splice(index, 1);
    }
  }

  // --- Core Update Logic ---

  /**
   * Marks this node and all its descendants as dirty.
   * This is necessary if, for example, a child is added or removed.
   */
  private makeDirty(): void {
    this._isDirty = true;
  }

  /**
   * Updates the world matrix of this node and all its children.
   * @param parentWorldMatrix The world matrix of the parent node.
   * @param force - If true, forces a matrix recalculation even if not dirty.
   */
  public updateWorldMatrix(parentWorldMatrix?: Mat4, force = false): void {
    const needsUpdate = this._isDirty || force;

    if (needsUpdate) {
      // Re-compose local matrix from position, rotation, and scale
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
    // If this node was updated, its children must also be updated.
    for (const child of this.children) {
      child.updateWorldMatrix(this.worldMatrix, needsUpdate);
    }
  }
}

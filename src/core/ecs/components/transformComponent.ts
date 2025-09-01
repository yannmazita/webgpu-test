// src/core/ecs/components/transformComponent.ts
import { mat3, Mat3, Mat4, mat4, Quat, quat, Vec3, vec3 } from "wgpu-matrix";
import { IComponent } from "../component";

export class TransformComponent implements IComponent {
  public position: Vec3 = vec3.create(0, 0, 0);
  public rotation: Quat = quat.identity();
  public scale: Vec3 = vec3.create(1, 1, 1);

  public localMatrix: Mat4 = mat4.identity();
  public worldMatrix: Mat4 = mat4.identity();

  public normalMatrix: Mat3 = mat3.identity(); // precomputed normal matrix

  /** True if the local transform has changed and matrices need recalculation. */
  public isDirty = true;
  /** True if the final world-space scaling is uniform (equal on all axes). */
  public isUniformlyScaled = true;

  // --- Helper methods to make manipulation easier ---
  // These methods simply modify data and mark the component as dirty.
  // The actual matrix calculations are done in the TransformSystem.

  public setPosition(p: Vec3): void;
  public setPosition(x: number, y: number, z: number): void;
  public setPosition(xOrVec: number | Vec3, y?: number, z?: number): void {
    if (typeof xOrVec === "number") {
      vec3.set(xOrVec, y!, z!, this.position);
    } else {
      vec3.copy(xOrVec, this.position);
    }
    this.isDirty = true;
  }

  public setRotation(q: Quat): void {
    quat.copy(q, this.rotation);
    this.isDirty = true;
  }

  public setScale(s: Vec3): void;
  public setScale(x: number, y: number, z: number): void;
  public setScale(xOrVec: number | Vec3, y?: number, z?: number): void {
    if (typeof xOrVec === "number") {
      vec3.set(xOrVec, y!, z!, this.scale);
    } else {
      vec3.copy(xOrVec, this.scale);
    }
    this.isDirty = true;
  }

  public translate(v: Vec3): void {
    vec3.add(this.position, v, this.position);
    this.isDirty = true;
  }

  public rotateX(rad: number): void {
    quat.rotateX(this.rotation, rad, this.rotation);
    this.isDirty = true;
  }

  public rotateY(rad: number): void {
    quat.rotateY(this.rotation, rad, this.rotation);
    this.isDirty = true;
  }

  public rotateZ(rad: number): void {
    quat.rotateZ(this.rotation, rad, this.rotation);
    this.isDirty = true;
  }
}

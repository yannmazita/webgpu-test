// src/shared/ecs/components/gameplay/transformComponent.ts
import { mat3, Mat3, Mat4, mat4, Quat, quat, Vec3, vec3 } from "wgpu-matrix";
import { IComponent } from "@/shared/ecs/component";

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

  /**
   * Sets the position of the transform.
   * @param p The new position.
   */
  public setPosition(p: Vec3): void;
  /**
   * Sets the position of the transform.
   * @param x The x coordinate.
   * @param y The y coordinate.
   * @param z The z coordinate.
   */
  public setPosition(x: number, y: number, z: number): void;
  public setPosition(xOrVec: number | Vec3, y?: number, z?: number): void {
    if (typeof xOrVec === "number") {
      vec3.set(xOrVec, y ?? 0, z ?? 0, this.position);
    } else {
      vec3.copy(xOrVec, this.position);
    }
    this.isDirty = true;
  }

  /**
   * Sets the rotation of the transform.
   * @param q The new rotation.
   */
  public setRotation(q: Quat): void {
    quat.copy(q, this.rotation);
    this.isDirty = true;
  }

  /**
   * Sets the scale of the transform.
   * @param s The new scale.
   */
  public setScale(s: Vec3): void;
  /**
   * Sets the scale of the transform.
   * @param x The x scale.
   * @param y The y scale.
   * @param z The z scale.
   */
  public setScale(x: number, y: number, z: number): void;
  public setScale(xOrVec: number | Vec3, y?: number, z?: number): void {
    if (typeof xOrVec === "number") {
      vec3.set(xOrVec, y ?? 0, z ?? 0, this.scale);
    } else {
      vec3.copy(xOrVec, this.scale);
    }
    this.isDirty = true;
  }

  /**
   * Translates the transform by a given vector.
   * @param v The vector to translate by.
   */
  public translate(v: Vec3): void {
    vec3.add(this.position, v, this.position);
    this.isDirty = true;
  }

  /**
   * Rotates the transform around the x-axis.
   * @param rad The angle in radians.
   */
  public rotateX(rad: number): void {
    quat.rotateX(this.rotation, rad, this.rotation);
    this.isDirty = true;
  }

  /**
   * Rotates the transform around the y-axis.
   * @param rad The angle in radians.
   */
  public rotateY(rad: number): void {
    quat.rotateY(this.rotation, rad, this.rotation);
    this.isDirty = true;
  }

  /**
   * Rotates the transform around the z-axis.
   * @param rad The angle in radians.
   */
  public rotateZ(rad: number): void {
    quat.rotateZ(this.rotation, rad, this.rotation);
    this.isDirty = true;
  }
}

// src/core/camera.ts
import { Mat4, mat4, vec3, Vec3, vec4, Vec4 } from "wgpu-matrix";

/**
 * Represents a camera in the 3D scene, managing view and projection matrices.
 * The camera determines the viewer's position and orientation (View) and
 * the lens properties like field-of-view (Projection).
 */
export class Camera {
  /** View matrix transforming from world space to view (camera) space. */
  public viewMatrix: Mat4;
  /** Projection transforming from view space to clip space. */
  public projectionMatrix: Mat4;
  /** Pre-calculated view-projection matrix (P * V) sent to the GPU. */
  public viewProjectionMatrix: Mat4;
  /** The camera's position in world space. */
  public position: Vec4;

  public fovYRadians: number;
  public near: number;
  public far: number;

  constructor() {
    this.viewMatrix = mat4.identity();
    this.projectionMatrix = mat4.identity();
    this.viewProjectionMatrix = mat4.identity();
    this.position = vec4.create(0, 0, 0, 1);
    this.fovYRadians = (75 * Math.PI) / 180;
    this.near = 0.1;
    this.far = 100.0;
  }

  /**
   * Configures the camera with a perspective projection matrix.
   *
   * @param fovYRadians The vertical field of view in radians.
   * @param aspectRatio The aspect ratio of the viewport (width / height).
   * @param near The distance to the near clipping plane.
   * @param far The distance to the far clipping plane.
   */
  public setPerspective(
    fovYRadians: number,
    aspectRatio: number,
    near: number,
    far: number,
  ): void {
    this.fovYRadians = fovYRadians;
    this.near = near;
    this.far = far;
    this.projectionMatrix = mat4.perspective(
      fovYRadians,
      aspectRatio,
      near,
      far,
    );
    this.updateViewProjectionMatrix();
  }

  /**
   * Updates the camera's view matrix to look at a specific target.
   *
   * @param position The position of the camera in world space.
   * @param target The point in world space the camera should look at.
   * @param up The vector defining the "up" direction for the camera,
   *   typically `(0, 1, 0)`.
   */
  public lookAt(
    position: Vec3,
    target: Vec3,
    up: Vec3 = vec3.create(0, 1, 0),
  ): void {
    this.viewMatrix = mat4.lookAt(position, target, up);
    // Store position as a Vec4 for uniform buffer alignment
    this.position[0] = position[0];
    this.position[1] = position[1];
    this.position[2] = position[2];
    this.position[3] = 1.0; // w component
    this.updateViewProjectionMatrix();
  }

  /**
   * Recalculates the combined view-projection matrix.
   * This is called internally whenever the view or projection matrix changes.
   */
  private updateViewProjectionMatrix(): void {
    // The order of multiplication is crucial: projection * view
    mat4.multiply(
      this.projectionMatrix,
      this.viewMatrix,
      this.viewProjectionMatrix,
    );
  }
}

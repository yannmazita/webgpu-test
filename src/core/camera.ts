// src/core/camera.ts
import { Mat4, mat4, vec3, Vec3 } from "wgpu-matrix";

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
  /** Inverse of the view matrix. */
  public inverseViewMatrix: Mat4;
  /** Inverse of the projection matrix. */
  public inverseProjectionMatrix: Mat4;
  /** The camera's position in world space. */
  public position: Vec3;
  /** The camera's local forward vector (points from camera to target). */
  public forward: Vec3;
  /** The camera's local up vector. */
  public up: Vec3;
  /** The camera's local right vector. */
  public right: Vec3;

  public fovYRadians: number;
  public near: number;
  public far: number;

  constructor() {
    this.viewMatrix = mat4.identity();
    this.projectionMatrix = mat4.identity();
    this.viewProjectionMatrix = mat4.identity();
    this.inverseViewMatrix = mat4.identity();
    this.inverseProjectionMatrix = mat4.identity();
    this.position = vec3.create(0, 0, 0);
    // forward, right and up make up a orthonormal basis for the camera's local coordinate system
    this.forward = vec3.create(0, 0, -1);
    this.up = vec3.create(0, 1, 0);
    this.right = vec3.create(1, 0, 0);
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
    mat4.invert(this.projectionMatrix, this.inverseProjectionMatrix);
    this.updateViewProjectionMatrix();
  }

  /**
   * Orients the camera to look from a specific position towards a target point.
   *
   * This method establishes the camera's local coordinate system (its orthonormal basis)
   * so that the camera's forward, right, and up vectors are mutually perpendicular.
   *
   * Finally, it constructs the `viewMatrix` from this basis and updates all related
   * camera matrices.
   *
   * @param position The position of the camera in world space.
   * @param target The point in world space the camera should look at.
   * @param worldUp The vector defining the "up" direction for the world.
   */
  public lookAt(
    position: Vec3,
    target: Vec3,
    worldUp: Vec3 = vec3.fromValues(0, 1, 0),
  ): void {
    vec3.copy(position, this.position);

    // 1. Calculate the forward vector (z-axis of the camera)
    vec3.subtract(target, position, this.forward);
    vec3.normalize(this.forward, this.forward);

    // 2. Calculate the right vector (x-axis of the camera)
    // Using the Gram-Schmidt process to project worldUp onto the plane perpendicular to 'forward'
    vec3.cross(this.forward, worldUp, this.right);
    vec3.normalize(this.right, this.right);

    // 3. Calculate the true up vector (y-axis of the camera)
    vec3.cross(this.right, this.forward, this.up);

    this.viewMatrix = mat4.lookAt(position, target, worldUp);
    mat4.invert(this.viewMatrix, this.inverseViewMatrix);
    this.updateViewProjectionMatrix();
  }

  /**
   * Rebuilds the view matrix directly from the camera's position and
   * its local orientation vectors (forward, up, right).
   * This should be called after the camera's properties are manipulated directly.
   */
  public updateViewMatrix(): void {
    // The target point is the camera's position plus its forward direction.
    const target = vec3.add(this.position, this.forward);

    // Use the library's built-in lookAt function, which correctly constructs
    // the view matrix from position, target, and up vector.
    this.viewMatrix = mat4.lookAt(this.position, target, this.up);

    mat4.invert(this.viewMatrix, this.inverseViewMatrix);
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

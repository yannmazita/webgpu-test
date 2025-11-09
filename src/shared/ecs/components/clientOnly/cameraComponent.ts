// src/shared/ecs/components/clientOnly/cameraComponent.ts
import { Mat4, mat4, Vec4, vec4 } from "wgpu-matrix";
import { IComponent } from "@/shared/ecs/component";

export class CameraComponent implements IComponent {
  // --- Projection Properties ---
  public fovYRadians: number;
  public aspectRatio: number;
  public near: number;
  public far: number;

  // --- Calculated Matrices ---
  public viewMatrix: Mat4 = mat4.identity();
  public projectionMatrix: Mat4 = mat4.identity();
  public viewProjectionMatrix: Mat4 = mat4.identity();
  public inverseViewMatrix: Mat4 = mat4.identity(); // World matrix of the camera
  public inverseProjectionMatrix: Mat4 = mat4.identity();

  // --- Frustum Planes ---
  // Stored as [a,b,c,d] where ax+by+cz+d=0
  // Normals point inward (negative half-space is inside frustum)
  // Order: [left, right, bottom, top, near, far]
  public frustumPlanes: Vec4[] = [
    vec4.create(),
    vec4.create(),
    vec4.create(),
    vec4.create(),
    vec4.create(),
    vec4.create(),
  ];

  constructor(fovYDegrees = 74, aspectRatio = 16 / 9, near = 0.1, far = 100.0) {
    this.fovYRadians = (fovYDegrees * Math.PI) / 180; // 74° vertical fov is 106 horizontal @ 16/9
    this.aspectRatio = aspectRatio;
    this.near = near;
    this.far = far;

    this.setPerspective(
      this.fovYRadians,
      this.aspectRatio,
      this.near,
      this.far,
    );
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
    this.aspectRatio = aspectRatio;
    this.near = near;
    this.far = far;

    mat4.perspective(
      this.fovYRadians,
      this.aspectRatio,
      this.near,
      this.far,
      this.projectionMatrix,
    );
    mat4.invert(this.projectionMatrix, this.inverseProjectionMatrix);
  }
}

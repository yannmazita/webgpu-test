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
  /** The camera's position in world space. */
  public position: Vec3;

  // GPU-related resources for the camera's uniform data.
  /** GPU buffer storing the view-projection matrix. */
  private buffer!: GPUBuffer;
  /** Bind group making the camera's buffer available to shaders. */
  public bindGroup!: GPUBindGroup;

  constructor() {
    this.viewMatrix = mat4.identity();
    this.projectionMatrix = mat4.identity();
    this.viewProjectionMatrix = mat4.identity();
    this.position = vec3.create(0, 0, 0);
  }

  /**
   * Initializes GPU resources for the camera.
   *
   * This creates the uniform buffer and the bind group needed to link the
   * matrix data of the camera to the shader pipeline.
   *
   * @param device The GPUDevice.
   * @param layout The GPUBindGroupLayout for the camera's uniforms (@group(0)).
   */
  public init(device: GPUDevice, layout: GPUBindGroupLayout): void {
    const MATRIX_SIZE = 4 * 4 * Float32Array.BYTES_PER_ELEMENT;
    this.buffer = device.createBuffer({
      label: "CAMERA_UNIFORM_BUFFER",
      size: MATRIX_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      label: "CAMERA_BIND_GROUP",
      layout: layout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.buffer },
        },
      ],
    });
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
    this.position = position;
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

  /**
   * Writes the current view-projection matrix to the associated GPU buffer.
   * This should be called once per frame before rendering.
   * @param queue The GPUQueue to use for the write operation.
   */
  public writeToGpu(queue: GPUQueue): void {
    if (!this.buffer) {
      console.error("Camera buffer not initialized. Call init() first.");
      return;
    }
    queue.writeBuffer(
      this.buffer,
      0,
      this.viewProjectionMatrix as Float32Array,
    );
  }
}

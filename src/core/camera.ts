// src/core/camera.ts
import { Mat4, mat4, vec3, Vec3 } from "wgpu-matrix";

/**
 * Represents a camera in the 3D scene, managing view and projection matrices.
 */
export class Camera {
  // Properties for camera matrices
  public viewMatrix: Mat4;
  public projectionMatrix: Mat4;
  public viewProjectionMatrix: Mat4;

  // GPU-related resources
  private buffer!: GPUBuffer;
  public bindGroup!: GPUBindGroup;

  constructor() {
    this.viewMatrix = mat4.identity();
    this.projectionMatrix = mat4.identity();
    this.viewProjectionMatrix = mat4.identity();
  }

  /**
   * Initializes GPU resources for the camera.
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
   * Sets a perspective projection matrix for the camera.
   * @param fovYRadians Field of view in the Y direction, in radians.
   * @param aspectRatio The aspect ratio of the canvas.
   * @param near The near clipping plane.
   * @param far The far clipping plane.
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
   * Updates the camera's view matrix based on its position and target.
   * @param position The position of the camera.
   * @param target The point the camera is looking at.
   * @param up The up vector for the camera (usually [0, 1, 0]).
   */
  public lookAt(
    position: Vec3,
    target: Vec3,
    up: Vec3 = vec3.create(0, 1, 0),
  ): void {
    this.viewMatrix = mat4.lookAt(position, target, up);
    this.updateViewProjectionMatrix();
  }

  /**
   * Recalculates the combined view-projection matrix.
   * This should be called whenever the view or projection matrix changes.
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
   * Writes the current view-projection matrix to the GPU buffer.
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

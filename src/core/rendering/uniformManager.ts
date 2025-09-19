// src/core/rendering/uniformManager.ts
import { Vec4 } from "wgpu-matrix";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";

/**
 * Manages the creation, packing, and updating of CPU-side data for uniform and
 * storage buffers.
 *
 * Its primary role is to act as an optimization layer between the high-level
 * scene data and the low-level GPU buffer writes. By using pre-allocated and
 * resizable `ArrayBuffer`s as staging areas, it avoids creating new arrays
 * every frame. This significantly reduces garbage collection pressure, which is
 * crucial for smooth, real-time rendering in ts.
 *
 * It ensures that data is packed into memory layouts that precisely match the
 * WGSL struct definitions in the shaders.
 */
export class UniformManager {
  /** A pre-allocated staging buffer for scene-wide uniform data. */
  private sceneDataArray: Float32Array;
  /** A pre-allocated staging buffer for camera-specific uniform data. */
  private cameraDataArray: Float32Array;
  /** A resizable, reusable buffer for light data, designed for an SSBO. */
  private lightDataBuffer: ArrayBuffer;
  /** The current capacity (in number of lights) of the lightDataBuffer. */
  private lightStorageBufferCapacity: number;

  constructor() {
    // scene array: cameraPos(4) + fogColor(4) + fogParams(4) + hdr(1) + prefiltered(1) + pad(2) = 16 floats
    this.sceneDataArray = new Float32Array(16);
    this.cameraDataArray = new Float32Array(32); // For 2 matrices
    this.lightStorageBufferCapacity = 4;
    const lightStructSize = 12 * Float32Array.BYTES_PER_ELEMENT; // 3 vec4 per light
    const bufferSize = 16 + this.lightStorageBufferCapacity * lightStructSize; // 16-byte header
    this.lightDataBuffer = new ArrayBuffer(bufferSize);
  }

  /**
   * Updates the camera uniform buffer with the latest view and view-projection
   * matrices.
   *
   * This method packs the matrices into a pre-allocated Float32Array and
   * queues a write to the specified GPU buffer.
   *
   * @param device The active GPUDevice.
   * @param buffer The target GPUBuffer for camera uniforms.
   * @param camera The CameraComponent containing the matrix data.
   */
  public updateCameraUniform(
    device: GPUDevice,
    buffer: GPUBuffer,
    camera: CameraComponent,
  ): void {
    // Copy view-projection matrix to the start of the array
    this.cameraDataArray.set(camera.viewProjectionMatrix, 0);
    // Copy view matrix after the first matrix (16 floats offset)
    this.cameraDataArray.set(camera.viewMatrix, 16);

    device.queue.writeBuffer(buffer, 0, this.cameraDataArray);
  }

  /**
   * Updates the scene uniform buffer with scene-wide data like camera position,
   * fog parameters, and rendering flags.
   *
   * @remarks
   * This function packs data into a pre-allocated Float32Array according to a
   * strict memory layout that must match the `SceneUniforms` struct in the WGSL
   * shaders. The current layout is (16 floats / 64 bytes):
   *
   * | Offset (Floats) | Member                   | Type          |
   * |:----------------|:-------------------------|:--------------|
   * | 0-3             | `cameraPos`              | `vec4<f32>`   |
   * | 4-7             | `fogColor`               | `vec4<f32>`   |
   * | 8-11            | `fogParams`              | `vec4<f32>`   |
   * | 12-15           | `miscParams`             | `vec4<f32>`   |
   *
   * @param device The active GPUDevice.
   * @param buffer The target GPUBuffer for scene uniforms.
   * @param camera The active scene camera, used for its world position.
   * @param fogEnabled A flag indicating if fog is active.
   * @param fogColor The ambient in-scattering color of the fog.
   * @param fogDensity The base density of the fog.
   * @param fogHeight The world-space Y coordinate for the fog's maximum density.
   * @param fogHeightFalloff The rate at which fog density decreases with altitude.
   * @param fogInscatteringIntensity The strength of the sun's contribution to fog color.
   * @param toneMappingEnabled Whether ACES tone mapping should be applied in shaders.
   * @param prefilteredMipLevels The number of mip levels in the prefiltered IBL map.
   */
  public updateSceneUniform(
    device: GPUDevice,
    buffer: GPUBuffer,
    camera: CameraComponent,
    fogEnabled: boolean,
    fogColor: Vec4,
    fogDensity: number,
    fogHeight: number,
    fogHeightFalloff: number,
    fogInscatteringIntensity: number,
    toneMappingEnabled?: boolean,
    prefilteredMipLevels?: number,
  ): void {
    // Packing data into the Float32Array
    // cameraPos: vec4<f32>
    this.sceneDataArray[0] = camera.inverseViewMatrix[12];
    this.sceneDataArray[1] = camera.inverseViewMatrix[13];
    this.sceneDataArray[2] = camera.inverseViewMatrix[14];
    this.sceneDataArray[3] = 1.0;

    // fogColor: vec4<f32>
    this.sceneDataArray.set(fogColor, 4);

    // fogParams: vec4<f32>
    this.sceneDataArray[8] = fogDensity;
    this.sceneDataArray[9] = fogHeight;
    this.sceneDataArray[10] = fogHeightFalloff;
    this.sceneDataArray[11] = fogInscatteringIntensity;

    // miscParams: vec4<f32> = [fogEnabled, toneMappingEnabled, prefilteredMipLevels, pad]
    this.sceneDataArray[12] = fogEnabled ? 1.0 : 0.0;
    this.sceneDataArray[13] = toneMappingEnabled ? 1.0 : 0.0;
    this.sceneDataArray[14] = prefilteredMipLevels ?? 0;
    this.sceneDataArray[15] = 0.0; // Padding

    // Uploading the packed data to the GPU buffer
    device.queue.writeBuffer(buffer, 0, this.sceneDataArray);
  }

  /**
   * Gets a reusable CPU-side ArrayBuffer for light data.
   *
   * This method provides a pre-allocated ArrayBuffer. If the requested number
   * of lights exceeds the buffer's current capacity, the buffer is resized
   * automatically. This avoids allocating a new buffer every frame.
   *
   * @param lightCount The number of lights that need to be stored.
   * @returns An ArrayBuffer with enough capacity for the specified lights.
   * The caller is responsible for creating views (ex: Uint32Array,
   * Float32Array) on this buffer to pack the light data.
   */
  public getLightDataBuffer(lightCount: number): ArrayBuffer {
    const lightStructSize = 12 * Float32Array.BYTES_PER_ELEMENT;
    if (lightCount > this.lightStorageBufferCapacity) {
      this.lightStorageBufferCapacity = Math.ceil(lightCount * 1.5);
      const newSize = 16 + this.lightStorageBufferCapacity * lightStructSize;
      this.lightDataBuffer = new ArrayBuffer(newSize);
    }
    return this.lightDataBuffer;
  }
}

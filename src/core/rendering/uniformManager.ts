// src/core/rendering/uniformManager.ts
import { Vec4 } from "wgpu-matrix";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";

/**
 * Manages uniform and storage buffers with dirty tracking to avoid redundant GPU updates
 */
export class UniformManager {
  // Pre-allocated arrays/buffers
  private sceneDataArray: Float32Array;
  private cameraDataArray: Float32Array;
  private lightDataBuffer: ArrayBuffer;
  private lightStorageBufferCapacity: number;

  constructor() {
    // cameraPos(4) + ambient(4) + fogColor(4) + fogParams0(4) + fogParams1(4) + hdr_enabled(1) + padding(3) = 24 floats
    this.sceneDataArray = new Float32Array(24);
    this.cameraDataArray = new Float32Array(32); // For 2 matrices
    this.lightStorageBufferCapacity = 4;
    const lightStructSize = 12 * Float32Array.BYTES_PER_ELEMENT; // 3 vec4 per light
    const bufferSize = 16 + this.lightStorageBufferCapacity * lightStructSize; // 16-byte header
    this.lightDataBuffer = new ArrayBuffer(bufferSize);
  }

  /**
   * Updates the camera uniform buffer with the view-projection matrix.
   *
   * This method is called every frame to ensure that the GPU has the latest
   * camera matrix for rendering.
   *
   * @param device The GPU device.
   * @param buffer The camera uniform buffer.
   * @param camera The camera component.
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
   * Updates the scene uniform buffer with scene-wide data.
   *
   * Backward compatible: hdrEnabled and prefilteredMipLevels are optional.
   * If omitted, HDR is considered disabled and prefiltered mips = 0.
   */
  public updateSceneUniform(
    device: GPUDevice,
    buffer: GPUBuffer,
    camera: CameraComponent,
    ambientColor: Vec4,
    fogColor: Vec4,
    fogParams0: Vec4, // [distanceDensity, height, heightFalloff, enableFlags]
    fogParams1: Vec4, // reserved/extensible
    hdrEnabled?: boolean,
    prefilteredMipLevels?: number,
  ): void {
    // camera pos
    this.sceneDataArray[0] = camera.inverseViewMatrix[12];
    this.sceneDataArray[1] = camera.inverseViewMatrix[13];
    this.sceneDataArray[2] = camera.inverseViewMatrix[14];
    this.sceneDataArray[3] = 1.0;
    // ambient
    this.sceneDataArray.set(ambientColor, 4);
    // fog
    this.sceneDataArray.set(fogColor, 8);
    this.sceneDataArray.set(fogParams0, 12);
    this.sceneDataArray.set(fogParams1, 16);
    // hdr flag (default false if not provided)
    this.sceneDataArray[20] = hdrEnabled ? 1.0 : 0.0;
    // prefiltered_mip_levels (default 0 if not provided)
    this.sceneDataArray[21] = prefilteredMipLevels ?? 0;

    device.queue.writeBuffer(buffer, 0, this.sceneDataArray);
  }

  /**
   * Gets a reusable ArrayBuffer for light data.
   *
   * This method provides a pre-allocated or resized ArrayBuffer to hold the
   * light data for the current frame. This is a memory optimization that
   * avoids allocating a new buffer every frame, which helps to reduce
   * garbage collection pauses.
   *
   * @param lightCount The number of lights in the scene.
   * @returns An ArrayBuffer with enough capacity to hold the light data.
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

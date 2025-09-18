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
    // scene array: cameraPos(4) + fogColor(4) + fogParams(4) + hdr(1) + prefiltered(1) + pad(2) = 16 floats
    this.sceneDataArray = new Float32Array(16);
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
    fogEnabled: boolean,
    fogColor: Vec4,
    fogDensity: number,
    fogHeight: number,
    fogHeightFalloff: number,
    fogInscatteringIntensity: number,
    hdrEnabled?: boolean,
    prefilteredMipLevels?: number,
  ): void {
    // camera pos
    this.sceneDataArray[0] = camera.inverseViewMatrix[12];
    this.sceneDataArray[1] = camera.inverseViewMatrix[13];
    this.sceneDataArray[2] = camera.inverseViewMatrix[14];
    this.sceneDataArray[3] = 1.0;
    // fog color
    this.sceneDataArray.set(fogColor, 4);
    // fog params
    this.sceneDataArray[8] = fogDensity;
    this.sceneDataArray[9] = fogHeight;
    this.sceneDataArray[10] = fogHeightFalloff;
    this.sceneDataArray[11] = fogInscatteringIntensity;
    // misc params
    this.sceneDataArray[12] = fogEnabled ? 1.0 : 0.0;
    this.sceneDataArray[13] = hdrEnabled ? 1.0 : 0.0;
    this.sceneDataArray[14] = prefilteredMipLevels ?? 0;
    // this.sceneDataArray[15] is padding

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

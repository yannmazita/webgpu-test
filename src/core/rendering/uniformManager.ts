// src/core/rendering/uniformManager.ts
import { Vec4 } from "wgpu-matrix";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";

/**
 * Manages uniform and storage buffers with dirty tracking to avoid redundant GPU updates
 */
export class UniformManager {
  // Pre-allocated arrays/buffers
  private sceneDataArray: Float32Array;
  private lightDataBuffer: ArrayBuffer;
  private lightStorageBufferCapacity: number;

  constructor() {
    this.sceneDataArray = new Float32Array(8); // cameraPos(3,1) + ambient(4)
    this.lightStorageBufferCapacity = 4;
    const lightStructSize = 8 * Float32Array.BYTES_PER_ELEMENT; // vec4 pos + vec4 color
    const bufferSize = 16 + this.lightStorageBufferCapacity * lightStructSize; // 4 bytes count padded to 16
    this.lightDataBuffer = new ArrayBuffer(bufferSize);
  }

  // Always write VP matrix
  public updateCameraUniform(
    device: GPUDevice,
    buffer: GPUBuffer,
    camera: CameraComponent,
  ): void {
    device.queue.writeBuffer(
      buffer,
      0,
      camera.viewProjectionMatrix as Float32Array,
    );
  }

  // Always write scene data: camera pos + ambient
  public updateSceneUniform(
    device: GPUDevice,
    buffer: GPUBuffer,
    camera: CameraComponent,
    ambientColor: Vec4,
  ): void {
    // Read camera pos directly from inverseViewMatrix
    this.sceneDataArray[0] = camera.inverseViewMatrix[12];
    this.sceneDataArray[1] = camera.inverseViewMatrix[13];
    this.sceneDataArray[2] = camera.inverseViewMatrix[14];
    this.sceneDataArray[3] = 1.0;
    // Ambient
    this.sceneDataArray.set(ambientColor, 4);
    device.queue.writeBuffer(buffer, 0, this.sceneDataArray);
  }

  // Get a reusable light data buffer, resizing if needed
  public getLightDataBuffer(lightCount: number): ArrayBuffer {
    const lightStructSize = 8 * Float32Array.BYTES_PER_ELEMENT;
    if (lightCount > this.lightStorageBufferCapacity) {
      this.lightStorageBufferCapacity = Math.ceil(lightCount * 1.5);
      const newSize = 16 + this.lightStorageBufferCapacity * lightStructSize;
      this.lightDataBuffer = new ArrayBuffer(newSize);
    }
    return this.lightDataBuffer;
  }
}

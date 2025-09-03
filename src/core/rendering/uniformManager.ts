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
    // cameraPos(4) + ambient(4) + fogColor(4) + fogParams0(4) + fogParams1(4) = 20 floats
    this.sceneDataArray = new Float32Array(20);
    this.lightStorageBufferCapacity = 4;
    const lightStructSize = 12 * Float32Array.BYTES_PER_ELEMENT; // 3 vec4 per light
    const bufferSize = 16 + this.lightStorageBufferCapacity * lightStructSize; // 16-byte header
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

  // Always write scene data
  public updateSceneUniform(
    device: GPUDevice,
    buffer: GPUBuffer,
    camera: CameraComponent,
    ambientColor: Vec4,
    fogColor: Vec4,
    fogParams0: Vec4, // [distanceDensity, height, heightFalloff, enableFlags]
    fogParams1: Vec4, // reserved/extensible
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

    device.queue.writeBuffer(buffer, 0, this.sceneDataArray);
  }

  // Get a reusable light data buffer, resizing if needed
  public getLightDataBuffer(lightCount: number): ArrayBuffer {
    const lightStructSize = 12 * Float32Array.BYTES_PER_ELEMENT; // CHANGED
    if (lightCount > this.lightStorageBufferCapacity) {
      this.lightStorageBufferCapacity = Math.ceil(lightCount * 1.5);
      const newSize = 16 + this.lightStorageBufferCapacity * lightStructSize;
      this.lightDataBuffer = new ArrayBuffer(newSize);
    }
    return this.lightDataBuffer;
  }
}

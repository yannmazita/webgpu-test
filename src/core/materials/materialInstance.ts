// src/core/materials/materialInstance.ts
import { Material } from "./material";

/**
 * Represents a unique instance of a material.
 * It holds instance-specific data like the uniform buffer and bind group,
 * while referencing a shared Material object for the shader, layout, and pipeline.
 */
export class MaterialInstance {
  private static nextId = 0;
  public readonly id: number;

  public readonly material: Material;
  public readonly uniformBuffer: GPUBuffer;
  public readonly bindGroup: GPUBindGroup;

  private device: GPUDevice;

  // A map from a glTF property path to a function that updates the uniform buffer.
  private uniformUpdaters = new Map<string, (value: Float32Array) => void>();

  constructor(
    device: GPUDevice,
    material: Material,
    uniformBuffer: GPUBuffer,
    bindGroup: GPUBindGroup,
  ) {
    this.id = MaterialInstance.nextId++;
    this.device = device;
    this.material = material;
    this.uniformBuffer = uniformBuffer;
    this.bindGroup = bindGroup;
  }

  /**
   * Registers a function that knows how to update a specific part of the uniform buffer.
   * @param propertyPath The property path (e.g., "pbrMetallicRoughness/baseColorFactor").
   * @param byteOffset The byte offset within the uniform buffer to write to.
   * @param sizeInFloats The number of float32 values to write.
   */
  public registerUniformUpdater(
    propertyPath: string,
    byteOffset: number,
    sizeInFloats: number,
  ): void {
    this.uniformUpdaters.set(propertyPath, (value: Float32Array) => {
      if (value.length < sizeInFloats) {
        console.warn(
          `Uniform update for "${propertyPath}" expected ${sizeInFloats} floats, got ${value.length}`,
        );
        return;
      }
      this.device.queue.writeBuffer(
        this.uniformBuffer,
        byteOffset,
        value.buffer,
        value.byteOffset,
        sizeInFloats * 4,
      );
    });
  }

  /**
   * Updates a named uniform property for this material instance.
   * This performs a partial write to the GPU uniform buffer.
   * @param propertyPath The property to update (e.g., "pbrMetallicRoughness/baseColorFactor").
   * @param value The new value as a Float32Array.
   */
  public updateUniform(propertyPath: string, value: Float32Array): void {
    const updater = this.uniformUpdaters.get(propertyPath);
    if (updater) {
      updater(value);
    } else {
      // This can happen if the model animates a property we haven't mapped.
      // console.warn(`No uniform updater registered for path: ${propertyPath}`);
    }
  }
}

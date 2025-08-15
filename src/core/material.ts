// src/core/material.ts
import { createTextureFromImage } from "./utils/texture";

/**
 * Represents the material properties of a renderable object, encapsulating
 * GPU resources like textures, samplers, and their corresponding bind group.
 */
export class Material {
  public texture!: GPUTexture;
  public sampler!: GPUSampler;
  public bindGroup!: GPUBindGroup;

  /**
   * Initializes the material by loading its texture and creating GPU resources.
   * This asynchronous method must be called before the material is used for rendering.
   *
   * @param device The GPUDevice to create resources with.
   * @param imageUrl The URL of the diffuse texture for this material.
   * @param layout The GPUBindGroupLayout that this material's bind group will adhere to.
   * @param modelUniformBuffer The GPUBuffer containing model matrix data.
   * @param modelUniformBufferSize The size of a single model matrix entry in the buffer.
   */
  public async init(
    device: GPUDevice,
    imageUrl: string,
    layout: GPUBindGroupLayout,
    modelUniformBuffer: GPUBuffer,
    modelUniformBufferSize: number,
  ): Promise<void> {
    this.texture = await createTextureFromImage(device, imageUrl);

    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });

    this.bindGroup = device.createBindGroup({
      label: `MATERIAL_BIND_GROUP_${imageUrl}`,
      layout: layout,
      entries: [
        {
          binding: 0, // Model Uniform Buffer
          resource: {
            buffer: modelUniformBuffer,
            size: modelUniformBufferSize,
          },
        },
        {
          binding: 1, // Texture View
          resource: this.texture.createView(),
        },
        {
          binding: 2, // Sampler
          resource: this.sampler,
        },
      ],
    });
  }
}

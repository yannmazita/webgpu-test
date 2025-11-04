// src/core/ecs/components/resources/iblComponent.ts
import { IComponent } from "@/core/ecs/component";

/**
 * A world resource component that holds the pre-computed textures for
 * Image-Based Lighting (IBL).
 */
export class IBLComponent implements IComponent {
  constructor(
    public irradianceMap: GPUTexture,
    public prefilteredMap: GPUTexture,
    public brdfLut: GPUTexture,
    public sampler: GPUSampler,
  ) {}
}

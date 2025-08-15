// src/core/resourceManager.ts
import { createTriforceMesh } from "@/features/triforce/meshes/triforceMesh";
import { Renderer } from "./renderer";
import { Material, Mesh } from "./types/gpu";
import { createTextureFromImage } from "./utils/texture";

/**
 * Manages the creation, loading, and caching of GPU resources like
 * materials and meshes.
 */
export class ResourceManager {
  private renderer: Renderer;
  private materials = new Map<string, Material>();
  private meshes = new Map<string, Mesh>();

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  /**
   * Creates a new material from a texture URL or retrieves it from cache
   * if it has already been loaded.
   *
   * @param imageUrl The URL of the diffuse texture for this material.
   * @returns A promise that resolves to the created or cached Material.
   */
  public async createMaterial(imageUrl: string): Promise<Material> {
    // Return cached material if it exists
    if (this.materials.has(imageUrl)) {
      return this.materials.get(imageUrl)!;
    }

    const texture = await createTextureFromImage(
      this.renderer.device,
      imageUrl,
    );

    const sampler = this.renderer.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });

    const bindGroup = this.renderer.device.createBindGroup({
      label: `MATERIAL_BIND_GROUP_${imageUrl}`,
      layout: this.renderer.getMaterialBindGroupLayout(),
      entries: [
        {
          binding: 0, // Model Uniform Buffer
          resource: {
            buffer: this.renderer.getModelUniformBuffer(),
            size: this.renderer.getAlignedMatrixSize(),
          },
        },
        {
          binding: 1, // Texture View
          resource: texture.createView(),
        },
        {
          binding: 2, // Sampler
          resource: sampler,
        },
      ],
    });

    // Create a new material
    const material: Material = {
      texture,
      sampler,
      bindGroup,
    };

    // Cache and return the new material
    this.materials.set(imageUrl, material);
    return material;
  }

  /**
   * Creates a triforce mesh.
   * @returns A Mesh object for the triforce.
   */
  public createTriforceMesh(): Mesh {
    const MESH_KEY = "TRIFORCE_MESH";
    if (this.meshes.has(MESH_KEY)) {
      return this.meshes.get(MESH_KEY)!;
    }

    const mesh = createTriforceMesh(this.renderer.device);
    this.meshes.set(MESH_KEY, mesh);
    return mesh;
  }
}

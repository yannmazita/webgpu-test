// src/core/resourceManager.ts
import { createTriforceMesh } from "@/features/triforce/meshes/triforceMesh";
import { Renderer } from "./renderer";
import { Material, Mesh } from "./types/gpu";
import { createTextureFromImage } from "./utils/texture";

/**
 * Manages the creation, loading, and caching of GPU resources.
 *
 * This class acts as a factory and cache for assets like materials (textures)
 * and meshes (vertex data). It prevents redundant GPU memory allocations
 * and texture loading, improving performance and simplifying resource access.
 */
export class ResourceManager {
  /** A reference to the main renderer instance. */
  private renderer: Renderer;
  /** A cache for `Material` objects, keyed by their texture image URL. */
  private materials = new Map<string, Material>();
  /** A cache for `Mesh` objects, keyed by a unique string identifier. */
  private meshes = new Map<string, Mesh>();

  /**
   * @param renderer The renderer used to access the `GPUDevice`
   *   and other GPU-related configurations.
   */
  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  /**
   * Creates a new material from a texture URL or retrieves it from the cache.
   *
   * A `Material` encapsulates a `GPUTexture`, a `GPUSampler`, and a
   * `GPUBindGroup` that links them to the shader pipeline. If a material for
   * the given `imageUrl` has already been created, the cached version is
   * returned to avoid redundant work.
   *
   * @param imageUrl The URL of the diffuse texture for this material.
   * @returns A promise that resolves to the created or cached `Material`.
   */
  public async createMaterial(imageUrl: string): Promise<Material> {
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

    const material: Material = {
      texture,
      sampler,
      bindGroup,
    };

    this.materials.set(imageUrl, material);
    return material;
  }

  /**
   * Creates the triforce mesh or retrieves it from the cache.
   *
   * A `Mesh` encapsulates a `GPUBuffer` containing vertex data and the
   * `GPUVertexBufferLayout` describing that data. This method ensures that the
   * triforce mesh is only created once.
   *
   * @returns The `Mesh` object for the triforce.
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

// src/core/resourceManager.ts
import { Renderer } from "./renderer";
import { Material, Mesh } from "./types/gpu";
import { MeshData } from "./types/mesh";
import { createTextureFromImage } from "./utils/texture";
import { createGPUBuffer } from "./utils/webgpu";
import { loadSTL } from "@/loaders/stlLoader";
import { load } from "@loaders.gl/core";
import { OBJLoader } from "@loaders.gl/obj";

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
  /** A 1x1 white texture for materials with no textures. */
  private dummyTexture!: GPUTexture;
  private defaultSampler!: GPUSampler;

  /**
   * @param renderer The renderer used to access the `GPUDevice`
   *   and other GPU-related configurations.
   */
  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.createDefaultResources();
  }

  private createDefaultResources(): void {
    // Create a 1x1 white texture for non-textured materials
    this.dummyTexture = this.renderer.device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.renderer.device.queue.writeTexture(
      { texture: this.dummyTexture },
      new Uint8Array([255, 255, 255, 255]), // White pixel
      { bytesPerRow: 4 },
      [1, 1],
    );

    // Create a default sampler
    this.defaultSampler = this.renderer.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
  }

  /**
   * Creates a new material from a texture URL or retrieves it from the cache.
   * @param imageUrl The URL of the diffuse texture for this material.
   * @param tintColor Optional RGBA color to tint the texture with.
   *   Values should be in the normalized [0.0, 1.0] range.
   *   Defaults to white [1, 1, 1, 1] (no tint).
   * @returns A promise that resolves to the created or cached Material.
   */
  public async createTextureMaterial(
    imageUrl: string,
    tintColor: [number, number, number, number] = [1, 1, 1, 1],
  ): Promise<Material> {
    const materialKey = `TEXTURE:${imageUrl}:${tintColor.join()}`;
    if (this.materials.has(materialKey)) {
      return this.materials.get(materialKey)!;
    }

    const texture = await createTextureFromImage(
      this.renderer.device,
      imageUrl,
    );
    const sampler = this.defaultSampler;

    // Padding the data for uniform buffer to 32 bytes (4*4 + 4 + pad + pad + pad)
    // [R, G, B, A, hasTexture, pad, pad, pad]
    const uniformData = new Float32Array(8);
    uniformData.set(tintColor, 0);
    uniformData[4] = 1; // hasTexture = 1 (as a float)

    const uniformBuffer = this.renderer.device.createBuffer({
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.renderer.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const bindGroup = this.renderer.device.createBindGroup({
      label: `MATERIAL_BIND_GROUP_${imageUrl}`,
      layout: this.renderer.getMaterialBindGroupLayout(),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    const material: Material = { texture, sampler, uniformBuffer, bindGroup };
    this.materials.set(materialKey, material);
    return material;
  }

  /**
   * Creates a solid color material or retrieves it from the cache.
   * @param color The RGBA color for the material. Values should be in the
   *   normalized [0.0, 1.0] range.
   * @returns The created or cached Material.
   */
  public createColorMaterial(
    color: [number, number, number, number],
  ): Material {
    const materialKey = `COLOR:${color.join()}`;
    if (this.materials.has(materialKey)) {
      return this.materials.get(materialKey)!;
    }

    // Data for the uniform buffer, also padded to 32 bytes
    const uniformData = new Float32Array(8);
    uniformData.set(color, 0);
    uniformData[4] = 0; // hasTexture = 0 (as a float)
    const uniformBuffer = this.renderer.device.createBuffer({
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.renderer.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const bindGroup = this.renderer.device.createBindGroup({
      label: `MATERIAL_BIND_GROUP_COLOR_${color.join()}`,
      layout: this.renderer.getMaterialBindGroupLayout(),
      entries: [
        { binding: 0, resource: this.dummyTexture.createView() },
        { binding: 1, resource: this.defaultSampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    const material: Material = {
      texture: this.dummyTexture,
      sampler: this.defaultSampler,
      uniformBuffer,
      bindGroup,
    };
    this.materials.set(materialKey, material);
    return material;
  }

  /**
   * Creates a GPU-ready mesh from raw data or retrieves it from the cache.
   *
   * This method takes separate arrays for each vertex attribute, creates a
   * dedicated GPUBuffer for each, and sets up the corresponding layouts.
   *
   * @param key A unique string to identify and cache the mesh.
   * @param data The raw vertex and index data for the mesh.
   * @returns The mesh object, ready for rendering.
   */
  public createMesh(key: string, data: MeshData): Mesh {
    if (this.meshes.has(key)) {
      return this.meshes.get(key)!;
    }

    const buffers: GPUBuffer[] = [];
    const layouts: GPUVertexBufferLayout[] = [];

    // Position Buffer (shaderLocation: 0)
    buffers.push(
      createGPUBuffer(
        this.renderer.device,
        data.positions,
        GPUBufferUsage.VERTEX,
      ),
    );
    layouts.push({
      arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT, // vec3<f32>
      attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
    });

    // Normal Buffer (shaderLocation: 1)
    buffers.push(
      createGPUBuffer(
        this.renderer.device,
        data.normals,
        GPUBufferUsage.VERTEX,
      ),
    );
    layouts.push({
      arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT, // vec3<f32>
      attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
    });

    // Texture Coordinate Buffer (shaderLocation: 2)
    // We must provide a buffer as this attribute is required by the shader.
    // If the model format doesn't include UVs, we create a dummy buffer.
    let texCoords = data.texCoords;
    if (!texCoords) {
      const vertexCount = data.positions.length / 3;
      texCoords = new Float32Array(vertexCount * 2); // Filled with zeros
    }
    buffers.push(
      createGPUBuffer(this.renderer.device, texCoords, GPUBufferUsage.VERTEX),
    );
    layouts.push({
      arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT, // vec2<f32>
      attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }],
    });

    // Index buffer
    const indexBuffer = createGPUBuffer(
      this.renderer.device,
      data.indices,
      GPUBufferUsage.INDEX,
    );

    const mesh: Mesh = {
      buffers,
      layouts,
      vertexCount: data.positions.length / 3,
      indexBuffer,
      indexCount: data.indices.length,
      indexFormat: data.indices instanceof Uint16Array ? "uint16" : "uint32",
    };

    this.meshes.set(key, mesh);
    return mesh;
  }

  /**
   * Loads, parses, and creates a mesh from an STL file.
   * @param url The URL of the .stl file.
   * @returns A promise that resolves to the created or cached Mesh.
   */
  public async loadMeshFromSTL(url: string): Promise<Mesh> {
    const meshKey = `STL:${url}`;
    if (this.meshes.has(meshKey)) {
      return this.meshes.get(meshKey)!;
    }

    const stlGeometry = await loadSTL(url);
    const meshData: MeshData = {
      positions: stlGeometry.vertices,
      normals: stlGeometry.normals,
      indices: stlGeometry.indices,
      // STL format does not contain UVs, so createMesh will generate dummies.
    };

    return this.createMesh(meshKey, meshData);
  }

  /**
   * Loads, parses, and creates a mesh from an OBJ file.
   * @param url The URL of the .obj file.
   * @returns A promise that resolves to the created or cached Mesh.
   */
  public async loadMeshFromOBJ(url: string): Promise<Mesh> {
    const meshKey = `OBJ:${url}`;
    if (this.meshes.has(meshKey)) {
      return this.meshes.get(meshKey)!;
    }

    const data = await load(url, OBJLoader);

    const meshData: MeshData = {
      positions: data.attributes.POSITION.value as Float32Array,
      normals: data.attributes.NORMAL.value as Float32Array,
      texCoords: data.attributes.TEXCOORD_0.value as Float32Array,
      indices: (data.indices?.value ?? new Uint32Array()) as
        | Uint16Array
        | Uint32Array,
    };

    return this.createMesh(meshKey, meshData);
  }
}

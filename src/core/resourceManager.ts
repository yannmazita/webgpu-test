// src/core/resourceManager.ts
import { Renderer } from "./renderer";
import { Material } from "./materials/material";
import { Mesh, PhongMaterialOptions } from "./types/gpu";
import { PhongMaterial } from "./materials/phongMaterial";
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
  /** A cache for Material objects keyed by their properties. */
  private materials = new Map<string, Material>();
  /** A cache for Mesh objects keyed by a unique string identifier. */
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
   * Creates a new Phong-lit material or retrieves it from the cache.
   *
   * This method configures a material with properties for the Phong lighting
   * model. If any options are omitted, the material will be created with
   * sensible default values.
   *
   * @param options - An object specifying the material properties.
   *   See the `PhongMaterialOptions` interface for details on each property
   *   and its corresponding default value.
   * @returns A promise that resolves to the created or cached `PhongMaterial`.
   */
  public async createPhongMaterial(
    options: PhongMaterialOptions = {},
  ): Promise<Material> {
    // Set default values for any undefined options
    const baseColor = options.baseColor ?? [1, 1, 1, 1];
    const specularColor = options.specularColor ?? [1, 1, 1];
    const shininess = options.shininess ?? 32.0;
    const textureUrl = options.textureUrl;

    // unique key for caching based on all properties
    const materialKey = `PHONG:${baseColor.join()}:${specularColor.join()}:${shininess}:${
      textureUrl ?? ""
    }`;
    if (this.materials.has(materialKey)) {
      return this.materials.get(materialKey)!;
    }

    // Determine the texture to use
    const texture = textureUrl
      ? await createTextureFromImage(this.renderer.device, textureUrl)
      : this.dummyTexture;

    const material = new PhongMaterial(
      this.renderer.device,
      options,
      texture,
      this.defaultSampler,
    );

    this.materials.set(materialKey, material);
    return material;
  }

  public createMesh(key: string, data: MeshData): Mesh {
    if (this.meshes.has(key)) {
      return this.meshes.get(key)!;
    }

    const buffers: GPUBuffer[] = [];
    const layouts: GPUVertexBufferLayout[] = [];
    const vertexCount = data.positions.length / 3;

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
    let normals = data.normals;
    if (!normals || normals.length === 0) {
      // If normals are missing, create a dummy buffer filled with zeros.
      // Lighting will be incorrect but it prevents a crash.
      console.warn(`Mesh "${key}" is missing normals. Generating dummy data.`);
      normals = new Float32Array(vertexCount * 3);
    }
    buffers.push(
      createGPUBuffer(this.renderer.device, normals, GPUBufferUsage.VERTEX),
    );
    layouts.push({
      arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT, // vec3<f32>
      attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
    });

    // Texture Coordinate (UVs) Buffer (shaderLocation: 2)
    // We must provide a buffer as this attribute is required by the shader.
    // If the model format doesn't include UVs, we create a dummy buffer.
    let texCoords = data.texCoords;
    if (!texCoords || texCoords.length === 0) {
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
      vertexCount: vertexCount,
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
      normals: data.attributes.NORMAL?.value as Float32Array,
      texCoords: data.attributes.TEXCOORD_0?.value as Float32Array,
      indices: (data.indices?.value ?? new Uint32Array()) as
        | Uint16Array
        | Uint32Array,
    };

    return this.createMesh(meshKey, meshData);
  }
}

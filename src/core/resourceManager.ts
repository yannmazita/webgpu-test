// src/core/resourceManager.ts
import { Renderer } from "./renderer";
import { Material } from "./materials/material";
import {
  AABB,
  Mesh,
  PBRMaterialOptions,
  UnlitGroundMaterialOptions,
} from "./types/gpu";
import { MeshData } from "./types/mesh";
import { createTextureFromImage } from "./utils/texture";
import { createGPUBuffer } from "./utils/webgpu";
import { loadSTL } from "@/loaders/stlLoader";
import { loadOBJ } from "@/loaders/objLoader";
import { ShaderPreprocessor } from "./shaders/preprocessor";
import { vec3 } from "wgpu-matrix";
import { PBRMaterial } from "./materials/pbrMaterial";
import {
  createCubeMeshData,
  createIcosphereMeshData,
} from "./utils/primitives";
import { UnlitGroundMaterial } from "./materials/unlitGroundMaterial";

export interface PBRMaterialSpec {
  type: "PBR";
  options: PBRMaterialOptions;
}

/**
 * Computes the axis-aligned bounding box from vertex positions.
 * @param positions Flattened array of vertex positions [x,y,z,x,y,z,...]
 * @returns AABB with min and max corners
 */
function computeAABB(positions: Float32Array): AABB {
  if (positions.length === 0) {
    // Empty mesh - return degenerate AABB
    return {
      min: vec3.create(0, 0, 0),
      max: vec3.create(0, 0, 0),
    };
  }

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  // Process every 3 floats as one vertex
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  return {
    min: vec3.create(minX, minY, minZ),
    max: vec3.create(maxX, maxY, maxZ),
  };
}

// Internal helpers for attaching stable metadata to runtime objects without polluting JSON
function _defineHidden<T extends object>(
  obj: T,
  key: string,
  value: any,
): void {
  Object.defineProperty(obj, key, {
    value,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}
function _setHandle(obj: object, handle: string): void {
  _defineHidden(obj, "__handle", handle);
}
function _getHandle(obj: any): string | undefined {
  return obj && typeof obj === "object" ? obj.__handle : undefined;
}
function _setPbrOptions(obj: object, options: PBRMaterialOptions): void {
  _defineHidden(obj, "__pbrOptions", options);
}
function _getPbrOptions(obj: any): PBRMaterialOptions | undefined {
  return obj && typeof obj === "object" ? obj.__pbrOptions : undefined;
}

/**
 * Manages the creation, loading, and caching of GPU resources.
 *
 * This class acts as a factory and cache for assets like materials (textures)
 * and meshes (vertex data). It prevents redundant GPU memory allocations
 * and texture loading, improving performance and simplifying resource access.
 */
export class ResourceManager {
  private static nextMeshId = 0;
  /** A reference to the main renderer instance. */
  private renderer: Renderer;
  /** A cache for Material objects keyed by their deterministic "materialKey". */
  private materials = new Map<string, Material>();
  /** A cache for Mesh objects keyed by a unique string identifier or handle. */
  private meshes = new Map<string, Mesh>();
  /** A 1x1 white texture for materials with no textures. */
  private dummyTexture!: GPUTexture;
  private defaultSampler!: GPUSampler;
  /** The shader preprocessor for handling #includes. */
  private preprocessor: ShaderPreprocessor;
  /** Flags to ensure material static resources are initialized only once. */
  private pbrMaterialInitialized = false;
  private unlitGroundMaterialInitialized = false;

  /**
   * Creates a new ResourceManager.
   * @param renderer The renderer used to access the `GPUDevice`
   *  and other GPU-related configurations.
   */
  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.preprocessor = new ShaderPreprocessor();
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

  // ---------- Handle and spec accessors for Scene IO ----------

  /**
   * Gets the handle for a given mesh.
   */
  public getHandleForMesh(mesh: Mesh): string | undefined {
    return _getHandle(mesh);
  }

  /**
   * Gets the handle for a given material.
   */
  public getHandleForMaterial(material: Material): string | undefined {
    return _getHandle(material);
  }

  /**
   * Gets the material specification for a given material.
   */
  public getMaterialSpec(material: Material): PBRMaterialSpec | undefined {
    const opts = _getPbrOptions(material);
    if (opts) {
      return { type: "PBR", options: opts };
    }
    return undefined;
  }

  // ---------- Material creation and resolution ----------

  /**
   * Creates a new PBR material or retrieves it from the cache.
   *
   * Uses a deterministic key derived from options (including texture URLs)
   * as the cache key. Also attaches non-enumerable metadata for scene
   * serialization.
   */
  public async createPBRMaterial(
    options: PBRMaterialOptions = {},
  ): Promise<Material> {
    // Default options
    const albedo = options.albedo ?? [1, 1, 1, 1];
    const metallic = options.metallic ?? 0.0;
    const roughness = options.roughness ?? 0.5;
    const normalIntensity = options.normalIntensity ?? 1.0;
    const emissive = options.emissive ?? [0, 0, 0];
    const occlusionStrength = options.occlusionStrength ?? 1.0;

    // Deterministic cache key
    const materialKey = `PBR:${albedo.join()}:${metallic}:${roughness}:${normalIntensity}:${emissive.join()}:${occlusionStrength}:${
      options.albedoMap ?? ""
    }:${options.metallicRoughnessMap ?? ""}:${options.normalMap ?? ""}:${
      options.emissiveMap ?? ""
    }:${options.occlusionMap ?? ""}`;

    const cached = this.materials.get(materialKey);
    if (cached) return cached;

    // Ensure shader/layout initialized
    if (!this.pbrMaterialInitialized) {
      await PBRMaterial.initialize(this.renderer.device, this.preprocessor);
      this.pbrMaterialInitialized = true;
    }

    // Load textures or use dummy; sRGB for albedo/emissive, linear for others
    const albedoTexture = options.albedoMap
      ? await createTextureFromImage(
          this.renderer.device,
          options.albedoMap,
          "rgba8unorm-srgb",
        )
      : this.dummyTexture;

    const metallicRoughnessTexture = options.metallicRoughnessMap
      ? await createTextureFromImage(
          this.renderer.device,
          options.metallicRoughnessMap,
          "rgba8unorm",
        )
      : this.dummyTexture;

    const normalTexture = options.normalMap
      ? await createTextureFromImage(
          this.renderer.device,
          options.normalMap,
          "rgba8unorm",
        )
      : this.dummyTexture;

    const emissiveTexture = options.emissiveMap
      ? await createTextureFromImage(
          this.renderer.device,
          options.emissiveMap,
          "rgba8unorm-srgb",
        )
      : this.dummyTexture;

    const occlusionTexture = options.occlusionMap
      ? await createTextureFromImage(
          this.renderer.device,
          options.occlusionMap,
          "rgba8unorm",
        )
      : this.dummyTexture;

    const material = new PBRMaterial(
      this.renderer.device,
      options,
      albedoTexture,
      metallicRoughnessTexture,
      normalTexture,
      emissiveTexture,
      occlusionTexture,
      this.defaultSampler,
    );

    // Attach stable handle and original options for scene serialization
    _setHandle(material, materialKey);
    // Clone array fields defensively
    const clonedOpts: PBRMaterialOptions = {
      ...options,
      albedo: options.albedo
        ? ([...options.albedo] as [number, number, number, number])
        : undefined,
      emissive: options.emissive
        ? ([...options.emissive] as [number, number, number])
        : undefined,
    };
    _setPbrOptions(material, clonedOpts);

    this.materials.set(materialKey, material);
    return material;
  }

  /**
   * Creates a new UnlitGround material for groundes or backgrounds.
   * @param options The configuration for the material, either a texture or a color.
   * @returns A promise that resolves to the UnlitMaterial instance.
   */
  public async createUnlitGroundMaterial(
    options: UnlitGroundMaterialOptions,
  ): Promise<Material> {
    const colorKey = options.color ? options.color.join(",") : "";
    const materialKey = `UNLIT_SKYBOX:${options.textureUrl ?? ""}:${colorKey}`;
    const cached = this.materials.get(materialKey);
    if (cached) return cached;

    // Ensure shader/layout initialized
    if (!this.unlitGroundMaterialInitialized) {
      await UnlitGroundMaterial.initialize(
        this.renderer.device,
        this.preprocessor,
      );
      this.unlitGroundMaterialInitialized = true;
    }

    const texture = options.textureUrl
      ? await createTextureFromImage(
          this.renderer.device,
          options.textureUrl,
          "rgba8unorm-srgb",
        )
      : this.dummyTexture;

    const material = new UnlitGroundMaterial(
      this.renderer.device,
      options,
      texture,
      this.defaultSampler,
    );

    this.materials.set(materialKey, material);
    return material;
  }

  /**
   * Resolves a material specification to a material instance.
   */
  public async resolveMaterialSpec(spec: PBRMaterialSpec): Promise<Material> {
    if (!spec || spec.type !== "PBR") {
      throw new Error("Unsupported material spec (expected type 'PBR').");
    }
    return this.createPBRMaterial(spec.options);
  }

  // ---------- Mesh resolution by handle ----------

  /**
   * Resolves a mesh from a string identifier, referred to as a "handle".
   *
   * This method loads or creates a mesh based on the handle's format. The
   * handle also serves as a cache key, ensuring that the same resource is not
   * loaded multiple times.
   *
   * Supported handle formats:
   * - **Primitives:**
   *   - `PRIM:cube` (default size 1.0)
   *   - `PRIM:cube:size=2.5`
   *   - `PRIM:icosphere` (default radius 0.5, subdivisions 2)
   *   - `PRIM:icosphere:r=1.0,sub=3`
   * - **Model Files:**
   *   - `OBJ:path/to/model.obj`
   *   - `STL:path/to/model.stl`
   */
  public async resolveMeshByHandle(handle: string): Promise<Mesh> {
    // Alias: if we already resolved this handle, return it
    const cached = this.meshes.get(handle);
    if (cached) return cached;

    if (handle.startsWith("PRIM:cube")) {
      // Optional size parameter: PRIM:cube:size=1
      let size = 1.0;
      const m = /size=([0-9]*\.?[0-9]+)/.exec(handle);
      if (m) size = parseFloat(m[1]);
      const data = createCubeMeshData(size);
      const mesh = this.createMesh(handle, data);
      _setHandle(mesh, handle);
      this.meshes.set(handle, mesh);
      return mesh;
    }

    if (handle.startsWith("PRIM:icosphere")) {
      // PRIM:icosphere:r=0.5,sub=2
      let r = 0.5,
        sub = 2;
      const rm = /r=([0-9]*\.?[0-9]+)/.exec(handle);
      const sm = /sub=([0-9]+)/.exec(handle);
      if (rm) r = parseFloat(rm[1]);
      if (sm) sub = parseInt(sm[1], 10);
      const data = createIcosphereMeshData(r, sub);
      const mesh = this.createMesh(handle, data);
      _setHandle(mesh, handle);
      this.meshes.set(handle, mesh);
      return mesh;
    }

    if (handle.startsWith("OBJ:")) {
      const url = handle.substring(4);
      const mesh = await this.loadMeshFromOBJ(url);
      _setHandle(mesh, handle);
      this.meshes.set(handle, mesh);
      return mesh;
    }

    if (handle.startsWith("STL:")) {
      const url = handle.substring(4);
      const mesh = await this.loadMeshFromSTL(url);
      _setHandle(mesh, handle);
      this.meshes.set(handle, mesh);
      return mesh;
    }

    throw new Error(`Unsupported mesh handle: ${handle}`);
  }

  // ---------- Low-level creation and loaders ----------

  /**
   * Creates a new mesh from the given mesh data.
   *
   * This is a low-level method that takes raw mesh data and creates the
   * necessary GPU buffers.
   * @param key A unique key to identify the mesh in the cache.
   * @param data The mesh data, including positions, normals, indices, and
   *     texture coordinates.
   * @returns The created mesh.
   */
  public createMesh(key: string, data: MeshData): Mesh {
    if (this.meshes.has(key)) {
      return this.meshes.get(key)!;
    }

    const buffers: GPUBuffer[] = [];
    const layouts: GPUVertexBufferLayout[] = [];
    const vertexCount = data.positions.length / 3;

    // Compute AABB from positions
    const aabb = computeAABB(data.positions);

    // Position Buffer (shaderLocation: 0)
    buffers.push(
      createGPUBuffer(
        this.renderer.device,
        data.positions,
        GPUBufferUsage.VERTEX,
        `${key}-positions`,
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
      createGPUBuffer(
        this.renderer.device,
        normals,
        GPUBufferUsage.VERTEX,
        `${key}-normals`,
      ),
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
      createGPUBuffer(
        this.renderer.device,
        texCoords,
        GPUBufferUsage.VERTEX,
        `${key}-uvs`,
      ),
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
      `${key}-indices`,
    );

    const mesh: Mesh = {
      buffers,
      layouts,
      vertexCount: vertexCount,
      indexBuffer,
      indexCount: data.indices.length,
      indexFormat: data.indices instanceof Uint16Array ? "uint16" : "uint32",
      aabb,
    };

    // unique ID for batching cache keys
    (mesh as any).id = ResourceManager.nextMeshId++;

    // Attach a best-effort handle if caller used a simple key
    let handle = key;
    if (key === "cube") handle = "PRIM:cube:size=1";
    if (key === "sphere") handle = "PRIM:icosphere:r=0.5,sub=2";
    _setHandle(mesh, handle);

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

    const mesh = this.createMesh(meshKey, meshData);
    _setHandle(mesh, meshKey);
    return mesh;
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

    const objGeometry = await loadOBJ(url);
    const meshData: MeshData = {
      positions: objGeometry.vertices,
      normals: objGeometry.normals,
      indices: objGeometry.indices,
      texCoords: objGeometry.uvs,
    };

    const mesh = this.createMesh(meshKey, meshData);
    _setHandle(mesh, meshKey);
    return mesh;
  }
}

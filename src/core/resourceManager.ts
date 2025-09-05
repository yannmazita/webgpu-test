// src/core/resourceManager.ts
import { Renderer } from "./renderer";
import { Material } from "./materials/material";
import { AABB, Mesh, PBRMaterialOptions } from "./types/gpu";
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

// Internal helpers for attaching stable handles to runtime objects without polluting JSON
function _setHandle(obj: object, handle: string): void {
  Object.defineProperty(obj, "__handle", {
    value: handle,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

function _getHandle(obj: any): string | undefined {
  return obj && typeof obj === "object" ? obj.__handle : undefined;
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
  /** A cache for Material objects keyed by their properties/handles. */
  private materials = new Map<string, Material>();
  /** A cache for Mesh objects keyed by a unique string identifier or handle. */
  private meshes = new Map<string, Mesh>();
  /** A 1x1 white texture for materials with no textures. */
  private dummyTexture!: GPUTexture;
  private defaultSampler!: GPUSampler;
  /** The shader preprocessor for handling #includes. */
  private preprocessor: ShaderPreprocessor;
  /** A flag to ensure PbrMaterial static resources are initialized only once. */
  private pbrMaterialInitialized = false;

  /**
   * @param renderer The renderer used to access the `GPUDevice`
   *   and other GPU-related configurations.
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

  // ---------- Handle accessors for Scene IO ----------

  public getHandleForMesh(mesh: Mesh): string | undefined {
    return _getHandle(mesh);
  }

  public getHandleForMaterial(material: Material): string | undefined {
    return _getHandle(material);
  }

  // ---------- PBR material handle parsing ----------

  private parsePBRHandle(handle: string): PBRMaterialOptions | null {
    if (!handle.startsWith("PBR:")) return null;
    // The materialKey used in createPBRMaterial is:
    // `PBR:${albedo.join()}:${metallic}:${roughness}:${normalIntensity}:${emissive.join()}:${occlusionStrength}:${albedoMap??""}:${metallicRoughnessMap??""}:${normalMap??""}:${emissiveMap??""}:${occlusionMap??""}`
    const parts = handle.split(":");
    if (parts.length < 7) return null;

    const parseFloatArray = (s: string, n: number): number[] => {
      const arr = s.split(",").map((v) => parseFloat(v));
      if (arr.length !== n || arr.some((v) => Number.isNaN(v))) return [];
      return arr;
    };

    const albedoArr = parseFloatArray(parts[1], 4);
    const metallic = parseFloat(parts[2]);
    const roughness = parseFloat(parts[3]);
    const normalIntensity = parseFloat(parts[4]);
    const emissiveArr = parseFloatArray(parts[5], 3);
    const occlusionStrength = parseFloat(parts[6]);

    // Optional maps
    const albedoMap = parts[7] || undefined;
    const metallicRoughnessMap = parts[8] || undefined;
    const normalMap = parts[9] || undefined;
    const emissiveMap = parts[10] || undefined;
    const occlusionMap = parts[11] || undefined;

    if (!albedoArr.length || !emissiveArr.length) return null;

    return {
      albedo: albedoArr as [number, number, number, number],
      metallic,
      roughness,
      normalIntensity,
      emissive: emissiveArr as [number, number, number],
      occlusionStrength,
      albedoMap,
      metallicRoughnessMap,
      normalMap,
      emissiveMap,
      occlusionMap,
    };
  }

  // ---------- Material resolution by handle ----------

  /**
   * Resolves a material handle to a Material instance (loads/creates if needed).
   * Currently supports PBR handles.
   */
  public async resolveMaterialByHandle(handle: string): Promise<Material> {
    // Return cached material if present
    const cached = this.materials.get(handle);
    if (cached) return cached;

    if (handle.startsWith("PBR:")) {
      const options = this.parsePBRHandle(handle);
      if (!options) throw new Error(`Invalid PBR handle: ${handle}`);
      // createPBRMaterial will build the same key and cache it
      const mat = await this.createPBRMaterial(options);
      // Ensure we can look it up by the exact handle string as well
      this.materials.set(handle, mat);
      return mat;
    }

    throw new Error(`Unsupported material handle: ${handle}`);
  }

  // ---------- Mesh resolution by handle ----------

  /**
   * Resolves a mesh handle to a Mesh instance (loads/creates if needed).
   * Supports PRIM:cube, PRIM:icosphere, OBJ:<url>, STL:<url>.
   */
  public async resolveMeshByHandle(handle: string): Promise<Mesh> {
    // Alias: if we already resolved this handle, return it
    if (this.meshes.has(handle)) {
      return this.meshes.get(handle)!;
    }

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
      // Also index by the handle for aliasing
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

    // Fallback to internal keys if someone passes a key we used for createMesh
    if (this.meshes.has(handle)) return this.meshes.get(handle)!;

    throw new Error(`Unsupported mesh handle: ${handle}`);
  }

  /**
   * Creates a new PBR material or retrieves it from the cache.
   */
  public async createPBRMaterial(
    options: PBRMaterialOptions = {},
  ): Promise<Material> {
    // Set default values
    const albedo = options.albedo ?? [1, 1, 1, 1];
    const metallic = options.metallic ?? 0.0;
    const roughness = options.roughness ?? 0.5;
    const normalIntensity = options.normalIntensity ?? 1.0;
    const emissive = options.emissive ?? [0, 0, 0];
    const occlusionStrength = options.occlusionStrength ?? 1.0;

    // Create unique cache key (also used as handle)
    const materialKey = `PBR:${albedo.join()}:${metallic}:${roughness}:${normalIntensity}:${emissive.join()}:${occlusionStrength}:${
      options.albedoMap ?? ""
    }:${options.metallicRoughnessMap ?? ""}:${options.normalMap ?? ""}:${
      options.emissiveMap ?? ""
    }:${options.occlusionMap ?? ""}`;

    if (this.materials.has(materialKey)) {
      return this.materials.get(materialKey)!;
    }

    // Initialize PBR material system once
    if (!this.pbrMaterialInitialized) {
      await PBRMaterial.initialize(this.renderer.device, this.preprocessor);
      this.pbrMaterialInitialized = true;
    }

    // Load textures or use dummy texture (note: sRGB for albedo/emissive, linear for others)
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

    // Attach a stable handle (materialKey) and cache
    _setHandle(material, materialKey);
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

    // unique ID for caching
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

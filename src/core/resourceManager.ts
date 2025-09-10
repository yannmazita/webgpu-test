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
import { quat, vec3 } from "wgpu-matrix";
import { PBRMaterial } from "./materials/pbrMaterial";
import {
  createCubeMeshData,
  createIcosphereMeshData,
} from "./utils/primitives";
import { UnlitGroundMaterial } from "./materials/unlitGroundMaterial";
import { loadHDR } from "@/loaders/hdrLoader";
import {
  equirectangularToCubemap,
  generateBrdfLut,
  generateIrradianceMap,
  generatePrefilteredMap,
} from "@/core/rendering/ibl";
import { SkyboxMaterial } from "@/core/materials/skyboxMaterial";
import { IBLComponent } from "@/core/ecs/components/iblComponent";
import {
  getAccessorData,
  GLTFPrimitive,
  loadGLTF,
  ParsedGLTF,
} from "@/loaders/gltfLoader";
import { TransformComponent } from "./ecs/components/transformComponent";
import { Entity } from "./ecs/entity";
import { World } from "./ecs/world";
import { setParent } from "./ecs/utils/hierarchy";
import { MeshRendererComponent } from "./ecs/components/meshRendererComponent";

// MikkTSpace WASM loader and wrapper
let mikktspace: {
  generateTangents: (
    pos: Float32Array,
    norm: Float32Array,
    uv: Float32Array,
  ) => Float32Array;
} | null = null;
let mikktspacePromise: Promise<void> | null = null;

async function initMikkTSpace() {
  if (mikktspace || mikktspacePromise) return mikktspacePromise;

  mikktspacePromise = new Promise(async (resolve, reject) => {
    try {
      // Try different import approaches
      const module = await import("mikktspace");

      // Handle different module formats
      if (typeof module.default === "function") {
        await module.default();
        mikktspace = module;
      } else if (typeof module.init === "function") {
        await module.init();
        mikktspace = module;
      } else if (module.generateTangents) {
        // Module might be pre-initialized
        mikktspace = module;
      } else {
        console.warn(
          "MikkTSpace module format not recognized:",
          Object.keys(module),
        );
        mikktspace = module;
      }

      console.log("MikkTSpace initialized successfully.");
      resolve();
    } catch (e) {
      console.error("Failed to initialize MikkTSpace:", e);
      // just continue without tangent generation
      resolve();
    }
  });
  return mikktspacePromise;
}

export interface PBRMaterialSpec {
  type: "PBR";
  options: PBRMaterialOptions;
}

export interface EnvironmentMap {
  skyboxMaterial: SkyboxMaterial;
  iblComponent: IBLComponent;
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
  /** 2D bidirectional reflectance distribution lookup table texture */
  private brdfLut: GPUTexture | null = null;
  /** Flags to ensure material static resources are initialized only once. */
  private pbrMaterialInitialized = false;
  private unlitGroundMaterialInitialized = false;
  private skyboxMaterialInitialized = false;

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
   * Loads an HDR environment map, converts it to a cubemap, pre-computes IBL textures,
   * and creates all necessary resources for environment lighting.
   * @param url The URL of the equirectangular .hdr file.
   * @param cubemapSize The resolution for each face of the resulting cubemap.
   * @returns A promise that resolves to an object containing the SkyboxMaterial and IBLComponent.
   */
  public async createEnvironmentMap(
    url: string,
    cubemapSize = 512,
  ): Promise<EnvironmentMap> {
    if (!this.skyboxMaterialInitialized) {
      await SkyboxMaterial.initialize(this.renderer.device, this.preprocessor);
      this.skyboxMaterialInitialized = true;
    }

    // --- 1. Load and prepare equirectangular source texture ---
    const hdrData = await loadHDR(url);
    const rgbaData = new Float32Array(hdrData.width * hdrData.height * 4);
    for (let i = 0; i < hdrData.width * hdrData.height; i++) {
      rgbaData[i * 4 + 0] = hdrData.data[i * 3 + 0];
      rgbaData[i * 4 + 1] = hdrData.data[i * 3 + 1];
      rgbaData[i * 4 + 2] = hdrData.data[i * 3 + 2];
      rgbaData[i * 4 + 3] = 1.0;
    }
    const equirectTexture = this.renderer.device.createTexture({
      label: `EQUIRECTANGULAR_SRC:${url}`,
      size: [hdrData.width, hdrData.height],
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.renderer.device.queue.writeTexture(
      { texture: equirectTexture },
      rgbaData.buffer,
      { bytesPerRow: hdrData.width * 4 * 4 },
      { width: hdrData.width, height: hdrData.height },
    );

    // --- 2. Convert to base environment cubemap ---
    const environmentMap = await equirectangularToCubemap(
      this.renderer.device,
      this.preprocessor,
      equirectTexture,
      cubemapSize,
    );
    equirectTexture.destroy();

    // --- 3. Create Skybox Material ---
    const skyboxSampler = this.renderer.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
    });
    const skyboxMaterial = new SkyboxMaterial(
      this.renderer.device,
      environmentMap,
      skyboxSampler,
    );
    _setHandle(skyboxMaterial, `SKYBOX:${url}:${cubemapSize}`);

    // --- 4. Pre-compute IBL Textures ---
    const irradianceMap = await generateIrradianceMap(
      this.renderer.device,
      this.preprocessor,
      environmentMap,
      skyboxSampler,
    );

    const prefilteredMap = await generatePrefilteredMap(
      this.renderer.device,
      this.preprocessor,
      environmentMap,
      skyboxSampler,
    );

    // BRDF LUT is scene-independent, so we generate and cache it once globally.
    this.brdfLut ??= await generateBrdfLut(
      this.renderer.device,
      this.preprocessor,
    );

    // --- 5. Create IBL Component ---
    const iblComponent = new IBLComponent(
      irradianceMap,
      prefilteredMap,
      this.brdfLut,
      skyboxSampler,
    );

    // We don't cache the entire EnvironmentMap object, just its components.
    this.materials.set(
      `SKYBOX:${url}:${cubemapSize}`,
      skyboxMaterial as Material,
    );

    return { skyboxMaterial, iblComponent };
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
   *   - "PRIM:cube" (default size 1.0)
   *   - "PRIM:cube:size=2.5"
   *   - "PRIM:icosphere" (default radius 0.5, subdivisions 2)
   *   - "PRIM:icosphere:r=1.0,sub=3"
   * - **Model Files:**
   *   - "OBJ:path/to/model.obj"
   *   - "STL:path/to/model.stl"
   *   -  "GLTF:url#meshName"
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
      const mesh = await this.createMesh(handle, data);
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
      const mesh = await this.createMesh(handle, data);
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

    if (handle.startsWith("GLTF:")) {
      // Format: GLTF:url#meshName
      const parts = handle.substring(5).split("#");
      const url = parts[0];
      const meshName = parts[1];
      if (!meshName) {
        throw new Error(
          "GLTF mesh handle requires a mesh name: GLTF:url#meshName",
        );
      }
      // This loads the first primitive of the named mesh.
      // For full scene loading, use loadSceneFromGLTF.
      const { parsedGltf } = await loadGLTF(url);
      const meshIndex = parsedGltf.json.meshes?.findIndex(
        (m) => m.name === meshName,
      );
      if (meshIndex === undefined || meshIndex === -1) {
        throw new Error(`Mesh "${meshName}" not found in ${url}`);
      }
      const gltfMesh = parsedGltf.json.meshes![meshIndex];
      const primitive = gltfMesh.primitives[0];
      const mesh = await this.createMeshFromPrimitive(
        handle,
        parsedGltf,
        primitive,
      );
      _setHandle(mesh, handle);
      this.meshes.set(handle, mesh);
      return mesh;
    }

    throw new Error(`Unsupported mesh handle: ${handle}`);
  }

  // ---------- Scene Loading ----------

  /**
   * Loads a glTF file and instantiates it into the world.
   * @param world The ECS world to add entities to.
   * @param url The URL of the .gltf or .glb file.
   * @returns A promise that resolves to the root entity of the loaded scene.
   */
  public async loadSceneFromGLTF(world: World, url: string): Promise<Entity> {
    const { parsedGltf: gltf, baseUri } = await loadGLTF(url);

    // --- Pre-load all materials ---
    const materialPromises =
      gltf.json.materials?.map((mat) => {
        const pbr = mat.pbrMetallicRoughness ?? {};
        const options: PBRMaterialOptions = {
          albedo: pbr.baseColorFactor,
          metallic: pbr.metallicFactor,
          roughness: pbr.roughnessFactor,
          emissive: mat.emissiveFactor,
          normalIntensity: mat.normalTexture?.scale,
          occlusionStrength: mat.occlusionTexture?.strength,
          // --- NEW: Set UV indices ---
          albedoUV: pbr.baseColorTexture?.texCoord ?? 0,
          metallicRoughnessUV: pbr.metallicRoughnessTexture?.texCoord ?? 0,
          normalUV: mat.normalTexture?.texCoord ?? 0,
          emissiveUV: mat.emissiveTexture?.texCoord ?? 0,
          occlusionUV: mat.occlusionTexture?.texCoord ?? 0,
        };

        if (pbr.baseColorTexture) {
          options.albedoMap = this.getImageUri(
            gltf,
            pbr.baseColorTexture.index,
            baseUri,
          );
        }
        if (pbr.metallicRoughnessTexture) {
          options.metallicRoughnessMap = this.getImageUri(
            gltf,
            pbr.metallicRoughnessTexture.index,
            baseUri,
          );
        }
        if (mat.normalTexture) {
          options.normalMap = this.getImageUri(
            gltf,
            mat.normalTexture.index,
            baseUri,
          );
        }
        if (mat.emissiveTexture) {
          options.emissiveMap = this.getImageUri(
            gltf,
            mat.emissiveTexture.index,
            baseUri,
          );
        }
        if (mat.occlusionTexture) {
          options.occlusionMap = this.getImageUri(
            gltf,
            mat.occlusionTexture.index,
            baseUri,
          );
        }
        return this.createPBRMaterial(options);
      }) ?? [];

    const materials = await Promise.all(materialPromises);

    // --- Instantiate scene graph ---
    const sceneIndex = gltf.json.scene ?? 0;
    const scene = gltf.json.scenes![sceneIndex];

    // Create a root entity for the entire glTF scene
    const sceneRootEntity = world.createEntity();
    world.addComponent(sceneRootEntity, new TransformComponent());

    const nodeToEntityMap = new Map<number, Entity>();

    // Recursively instantiate nodes
    for (const nodeIndex of scene.nodes) {
      await this.instantiateNode(
        world,
        gltf,
        nodeIndex,
        sceneRootEntity,
        materials,
        nodeToEntityMap,
      );
    }

    return sceneRootEntity;
  }

  private async instantiateNode(
    world: World,
    gltf: ParsedGLTF,
    nodeIndex: number,
    parentEntity: Entity,
    materials: Material[],
    nodeToEntityMap: Map<number, Entity>,
  ): Promise<void> {
    const node = gltf.json.nodes![nodeIndex];
    const entity = world.createEntity();
    nodeToEntityMap.set(nodeIndex, entity);

    // --- Transform ---
    const transform = new TransformComponent();
    if (node.matrix) {
      // Decompose matrix for consistency, though less precise.
      const pos = vec3.create();
      const rot = quat.create();
      const scl = vec3.create();
      vec3.set(pos, node.matrix[12], node.matrix[13], node.matrix[14]);
      // A full matrix decomposition is complex. This is a simplification just to push
      // Right now we'll just handle translation from matrix.
      // todo: proper implementation using mat4.getTranslation, getScaling, getRotation etc
      transform.setPosition(pos);
    } else {
      if (node.translation)
        transform.setPosition(vec3.fromValues(...node.translation));
      if (node.rotation)
        transform.setRotation(quat.fromValues(...node.rotation));
      if (node.scale) transform.setScale(vec3.fromValues(...node.scale));
    }
    world.addComponent(entity, transform);
    setParent(world, entity, parentEntity);

    // --- Mesh Renderer ---
    if (node.mesh !== undefined) {
      const gltfMesh = gltf.json.meshes![node.mesh];
      // If a mesh has multiple primitives, create a child entity for each.
      // This correctly handles primitives with different materials.
      const meshRootEntity =
        gltfMesh.primitives.length > 1 ? world.createEntity() : entity;
      if (gltfMesh.primitives.length > 1) {
        world.addComponent(meshRootEntity, new TransformComponent());
        setParent(world, meshRootEntity, entity);
      }

      for (let i = 0; i < gltfMesh.primitives.length; i++) {
        const primitive = gltfMesh.primitives[i];
        const primitiveEntity =
          gltfMesh.primitives.length > 1
            ? world.createEntity()
            : meshRootEntity;
        if (gltfMesh.primitives.length > 1) {
          world.addComponent(primitiveEntity, new TransformComponent());
          setParent(world, primitiveEntity, meshRootEntity);
        }

        // Get or create the mesh for this primitive
        const meshCacheKey = `GLTF:${gltf.json.asset.version}#mesh${node.mesh}#primitive${i}`;
        const mesh = await this.createMeshFromPrimitive(
          meshCacheKey,
          gltf,
          primitive,
        );
        this.meshes.set(meshCacheKey, mesh);
        _setHandle(mesh, meshCacheKey);

        // Get the material
        const material =
          primitive.material !== undefined
            ? materials[primitive.material]
            : materials[0]; // Fallback to default
        world.addComponent(
          primitiveEntity,
          new MeshRendererComponent(mesh, material),
        );
      }
    }

    // --- Recurse for children ---
    if (node.children) {
      for (const childNodeIndex of node.children) {
        await this.instantiateNode(
          world,
          gltf,
          childNodeIndex,
          entity,
          materials,
          nodeToEntityMap,
        );
      }
    }
  }

  private getImageUri(
    gltf: ParsedGLTF,
    textureIndex: number,
    baseUri: string,
  ): string | undefined {
    const { json, buffers } = gltf;
    const texture = json.textures?.[textureIndex];
    if (texture?.source === undefined) return undefined;

    const image = json.images?.[texture.source];
    if (!image) return undefined;

    if (image.uri) {
      // Handle Data URI
      if (image.uri.startsWith("data:")) {
        return image.uri;
      }
      // Handle external URI
      return new URL(image.uri, baseUri).href;
    }

    if (image.bufferView !== undefined && image.mimeType) {
      // Handle embedded image data from bufferView
      const bufferView = json.bufferViews![image.bufferView];
      const buffer = buffers[bufferView.buffer];
      const imageData = new Uint8Array(
        buffer,
        bufferView.byteOffset ?? 0,
        bufferView.byteLength,
      );
      const blob = new Blob([imageData], { type: image.mimeType });
      return URL.createObjectURL(blob);
    }

    return undefined;
  }

  private async createMeshFromPrimitive(
    key: string,
    gltf: ParsedGLTF,
    primitive: GLTFPrimitive,
  ): Promise<Mesh> {
    if (this.meshes.has(key)) {
      return this.meshes.get(key)!;
    }

    const posAccessor = primitive.attributes.POSITION;
    const normAccessor = primitive.attributes.NORMAL;
    const uv0Accessor = primitive.attributes.TEXCOORD_0;
    const uv1Accessor = primitive.attributes.TEXCOORD_1;
    const indicesAccessor = primitive.indices;

    if (posAccessor === undefined || indicesAccessor === undefined) {
      throw new Error("GLTF primitive must have POSITION and indices.");
    }

    const positions = getAccessorData(gltf, posAccessor) as Float32Array;
    const indices = getAccessorData(gltf, indicesAccessor) as
      | Uint16Array
      | Uint32Array;
    const normals =
      normAccessor !== undefined
        ? (getAccessorData(gltf, normAccessor) as Float32Array)
        : new Float32Array();
    const texCoords =
      uv0Accessor !== undefined
        ? (getAccessorData(gltf, uv0Accessor) as Float32Array)
        : new Float32Array();
    const texCoords1 =
      uv1Accessor !== undefined
        ? (getAccessorData(gltf, uv1Accessor) as Float32Array)
        : new Float32Array();

    const meshData: MeshData = {
      positions,
      normals,
      texCoords,
      texCoords1,
      indices,
    };
    const mesh = await this.createMesh(key, meshData);
    this.meshes.set(key, mesh);
    return mesh;
  }

  private validateMeshData(
    key: string,
    data: {
      positions: Float32Array;
      normals?: Float32Array;
      texCoords?: Float32Array;
      texCoords1?: Float32Array;
      tangents?: Float32Array;
      indices?: Uint16Array | Uint32Array;
    },
    vertexCount: number,
  ): void {
    console.group(`[ResourceManager] Validating mesh data for "${key}"`);

    // Check positions
    console.log(
      `Positions: ${data.positions.length} floats (${
        data.positions.length / 3
      } vertices)`,
    );
    if (data.positions.length !== vertexCount * 3) {
      console.error(
        `Position count mismatch! Expected ${vertexCount * 3}, got ${
          data.positions.length
        }`,
      );
    }

    // Sample first vertex
    if (data.positions.length >= 3) {
      console.log(
        `  First position: [${data.positions[0].toFixed(
          2,
        )}, ${data.positions[1].toFixed(2)}, ${data.positions[2].toFixed(2)}]`,
      );
    }

    // Check for NaN/Infinity
    for (let i = 0; i < Math.min(data.positions.length, 12); i++) {
      if (!isFinite(data.positions[i])) {
        console.error(`  Invalid position at index ${i}: ${data.positions[i]}`);
      }
    }

    // Check normals
    if (data.normals) {
      console.log(`Normals: ${data.normals.length} floats`);
      if (data.normals.length !== vertexCount * 3) {
        console.error(
          `Normal count mismatch! Expected ${vertexCount * 3}, got ${
            data.normals.length
          }`,
        );
      }
      if (data.normals.length >= 3) {
        console.log(
          `  First normal: [${data.normals[0].toFixed(
            2,
          )}, ${data.normals[1].toFixed(2)}, ${data.normals[2].toFixed(2)}]`,
        );
      }
    }

    // Check UVs
    if (data.texCoords) {
      console.log(`TexCoords0: ${data.texCoords.length} floats`);
      if (data.texCoords.length !== vertexCount * 2) {
        console.error(
          `TexCoord0 count mismatch! Expected ${vertexCount * 2}, got ${
            data.texCoords.length
          }`,
        );
      }
      if (data.texCoords.length >= 2) {
        console.log(
          `  First UV0: [${data.texCoords[0].toFixed(
            2,
          )}, ${data.texCoords[1].toFixed(2)}]`,
        );
      }
    }

    // Check UV1s
    if (data.texCoords1 && data.texCoords1.length > 0) {
      console.log(`TexCoords1: ${data.texCoords1.length} floats`);
      if (data.texCoords1.length !== vertexCount * 2) {
        console.error(
          `TexCoord1 count mismatch! Expected ${vertexCount * 2}, got ${
            data.texCoords1.length
          }`,
        );
      }
      if (data.texCoords1.length >= 2) {
        console.log(
          `  First UV1: [${data.texCoords1[0].toFixed(
            2,
          )}, ${data.texCoords1[1].toFixed(2)}]`,
        );
      }
    } else {
      console.log(`TexCoords1: Not provided.`);
    }

    // Check tangents
    if (data.tangents) {
      console.log(`Tangents: ${data.tangents.length} floats`);
      if (data.tangents.length !== vertexCount * 4) {
        console.error(
          `Tangent count mismatch! Expected ${vertexCount * 4}, got ${
            data.tangents.length
          }`,
        );
      }
      if (data.tangents.length >= 4) {
        console.log(
          `  First tangent: [${data.tangents[0].toFixed(
            2,
          )}, ${data.tangents[1].toFixed(2)}, ${data.tangents[2].toFixed(
            2,
          )}, ${data.tangents[3].toFixed(2)}]`,
        );
      }
    }

    // Check indices
    if (data.indices) {
      console.log(`Indices: ${data.indices.length}`);
      const maxIndex = Math.max(
        ...Array.from(
          data.indices.slice(0, Math.min(100, data.indices.length)),
        ),
      );
      const minIndex = Math.min(
        ...Array.from(
          data.indices.slice(0, Math.min(100, data.indices.length)),
        ),
      );
      console.log(
        `  Index range: ${minIndex} to ${maxIndex} (vertex count: ${vertexCount})`,
      );
      if (maxIndex >= vertexCount) {
        console.error(
          `Index out of bounds! Max index ${maxIndex} >= vertex count ${vertexCount}`,
        );
      }
    }

    console.groupEnd();
  }

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
  public async createMesh(key: string, data: MeshData): Promise<Mesh> {
    if (this.meshes.has(key)) {
      return this.meshes.get(key)!;
    }

    const hasTexCoords = data.texCoords && data.texCoords.length > 0;
    const hasNormals = data.normals && data.normals.length > 0;
    let canGenerateTangents =
      hasTexCoords && hasNormals && data.positions.length > 0;

    let finalPositions = data.positions;
    let finalNormals = data.normals;
    let finalTexCoords = data.texCoords;
    let finalTexCoords1 = data.texCoords1;
    let finalTangents: Float32Array | undefined; // <<< FIX: DECLARED HERE
    let finalIndices: Uint16Array | Uint32Array | undefined = data.indices;
    let finalVertexCount = data.positions.length / 3;

    if (canGenerateTangents) {
      const vertexCount = data.positions.length / 3;

      // Validate that we have properly sized arrays
      const hasValidNormals =
        data.normals && data.normals.length === vertexCount * 3;
      const hasValidTexCoords =
        data.texCoords && data.texCoords.length === vertexCount * 2;

      if (!hasValidNormals || !hasValidTexCoords) {
        console.warn(
          `[ResourceManager] Mesh "${key}" has invalid vertex data. ` +
            `Positions: ${data.positions.length}, Normals: ${
              data.normals?.length || 0
            }, ` +
            `TexCoords: ${
              data.texCoords?.length || 0
            }. Skipping tangent generation.`,
        );
        canGenerateTangents = false;
      } else if (data.indices && data.indices.length > 0) {
        // MikkTSpace requires un-indexed geometry. We de-index, generate tangents, then re-index.
        const indexCount = data.indices.length;
        const deindexedPositions = new Float32Array(indexCount * 3);
        const deindexedNormals = new Float32Array(indexCount * 3);
        const deindexedTexCoords = new Float32Array(indexCount * 2);

        // De-index the geometry
        for (let i = 0; i < indexCount; i++) {
          const index = data.indices[i];

          // Add bounds checking
          if (index >= vertexCount) {
            console.error(
              `[ResourceManager] Invalid index ${index} in mesh "${key}" (vertex count: ${vertexCount})`,
            );
            continue;
          }

          deindexedPositions.set(
            data.positions.subarray(index * 3, index * 3 + 3),
            i * 3,
          );
          deindexedNormals.set(
            data.normals.subarray(index * 3, index * 3 + 3),
            i * 3,
          );
          deindexedTexCoords.set(
            data.texCoords.subarray(index * 2, index * 2 + 2),
            i * 2,
          );
        }

        try {
          // Ensure MikkTSpace is initialized before use
          await initMikkTSpace();
          if (!mikktspace) {
            throw new Error("MikkTSpace library is not available.");
          }

          console.log(
            `[ResourceManager] Generating tangents for mesh "${key}"...`,
          );
          const deindexedTangents = mikktspace.generateTangents(
            deindexedPositions,
            deindexedNormals,
            deindexedTexCoords,
          );
          console.log(
            `[ResourceManager] Tangent generation successful for "${key}".`,
          );

          // Now we need to re-index the geometry to restore indexed rendering
          // We'll create a map to track unique vertices
          const vertexMap = new Map<string, number>();
          const uniquePositions: number[] = [];
          const uniqueNormals: number[] = [];
          const uniqueTexCoords: number[] = [];
          const uniqueTangents: number[] = [];
          const newIndices: number[] = [];

          // Process each vertex from the de-indexed data
          for (let i = 0; i < indexCount; i++) {
            // Create a hash key for this vertex
            const p = [
              deindexedPositions[i * 3],
              deindexedPositions[i * 3 + 1],
              deindexedPositions[i * 3 + 2],
            ];
            const n = [
              deindexedNormals[i * 3],
              deindexedNormals[i * 3 + 1],
              deindexedNormals[i * 3 + 2],
            ];
            const t = [
              deindexedTexCoords[i * 2],
              deindexedTexCoords[i * 2 + 1],
            ];
            const tan = [
              deindexedTangents[i * 4],
              deindexedTangents[i * 4 + 1],
              deindexedTangents[i * 4 + 2],
              deindexedTangents[i * 4 + 3],
            ];

            // Create a key that represents this unique vertex
            // We use lower precision to merge very close vertices
            const key =
              `${p[0].toFixed(6)},${p[1].toFixed(6)},${p[2].toFixed(6)},` +
              `${n[0].toFixed(4)},${n[1].toFixed(4)},${n[2].toFixed(4)},` +
              `${t[0].toFixed(6)},${t[1].toFixed(6)},` +
              `${tan[0].toFixed(4)},${tan[1].toFixed(4)},${tan[2].toFixed(
                4,
              )},${tan[3].toFixed(4)}`;

            let vertexIndex = vertexMap.get(key);
            if (vertexIndex === undefined) {
              // This is a new unique vertex
              vertexIndex = uniquePositions.length / 3;
              vertexMap.set(key, vertexIndex);

              uniquePositions.push(...p);
              uniqueNormals.push(...n);
              uniqueTexCoords.push(...t);
              uniqueTangents.push(...tan);
            }

            newIndices.push(vertexIndex);
          }

          // Update final data with re-indexed geometry
          finalPositions = new Float32Array(uniquePositions);
          finalNormals = new Float32Array(uniqueNormals);
          finalTexCoords = new Float32Array(uniqueTexCoords);
          finalTangents = new Float32Array(uniqueTangents);
          finalIndices =
            newIndices.length > 65536
              ? new Uint32Array(newIndices)
              : new Uint16Array(newIndices);
          finalVertexCount = uniquePositions.length / 3;

          console.log(
            `[ResourceManager] Re-indexed mesh "${key}": ${indexCount} indices -> ` +
              `${finalVertexCount} unique vertices, ${finalIndices.length} indices`,
          );
        } catch (e) {
          console.error(
            `MikkTSpace failed for mesh "${key}". Falling back to default tangents.`,
            e,
          );
          finalTangents = undefined; // Ensure fallback is triggered
        }
      } else {
        // Non-indexed geometry - generate tangents directly
        try {
          await initMikkTSpace();
          if (mikktspace) {
            console.log(
              `[ResourceManager] Generating tangents for non-indexed mesh "${key}"...`,
            );
            finalTangents = mikktspace.generateTangents(
              data.positions,
              data.normals!,
              data.texCoords!,
            );
          }
        } catch (e) {
          console.error(`MikkTSpace failed for non-indexed mesh "${key}".`, e);
        }
      }
    }

    this.validateMeshData(
      key,
      {
        positions: finalPositions,
        normals: finalNormals,
        texCoords: finalTexCoords,
        texCoords1: finalTexCoords1,
        tangents: finalTangents,
        indices: finalIndices,
      },
      finalVertexCount,
    );

    // Use explicit arrays with fixed size to ensure ordering
    const buffers: (GPUBuffer | undefined)[] = new Array(5);
    const layouts: (GPUVertexBufferLayout | undefined)[] = new Array(5);

    // Compute AABB from original positions for culling
    const aabb = computeAABB(data.positions);

    // Create buffers in exact order matching shader expectations
    // Buffer 0: Position (shaderLocation: 0)
    buffers[0] = createGPUBuffer(
      this.renderer.device,
      finalPositions,
      GPUBufferUsage.VERTEX,
      `${key}-positions`,
    );
    layouts[0] = {
      arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT,
      stepMode: "vertex" as GPUVertexStepMode, // Explicit stepMode
      attributes: [
        {
          shaderLocation: 0,
          offset: 0,
          format: "float32x3" as GPUVertexFormat,
        },
      ],
    };

    // Buffer 1: Normal (shaderLocation: 1)
    let normals = finalNormals;
    if (!normals || normals.length === 0) {
      console.warn(
        `Mesh "${key}" is missing normals. Generating default [0,1,0].`,
      );
      normals = new Float32Array(finalVertexCount * 3);
      // Default to up-facing normals
      for (let i = 0; i < finalVertexCount; i++) {
        normals[i * 3 + 1] = 1.0; // Y = 1
      }
    }
    buffers[1] = createGPUBuffer(
      this.renderer.device,
      normals,
      GPUBufferUsage.VERTEX,
      `${key}-normals`,
    );
    layouts[1] = {
      arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT,
      stepMode: "vertex" as GPUVertexStepMode,
      attributes: [
        {
          shaderLocation: 1,
          offset: 0,
          format: "float32x3" as GPUVertexFormat,
        },
      ],
    };

    // Buffer 2: Texture Coordinates 0 (shaderLocation: 2)
    let texCoords = finalTexCoords;
    if (!texCoords || texCoords.length === 0) {
      console.warn(`Mesh "${key}" is missing UVs. Generating zeros.`);
      texCoords = new Float32Array(finalVertexCount * 2);
    }
    buffers[2] = createGPUBuffer(
      this.renderer.device,
      texCoords,
      GPUBufferUsage.VERTEX,
      `${key}-texCoords0`,
    );
    layouts[2] = {
      arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
      stepMode: "vertex" as GPUVertexStepMode,
      attributes: [
        {
          shaderLocation: 2,
          offset: 0,
          format: "float32x2" as GPUVertexFormat,
        },
      ],
    };

    // Buffer 3: Tangent (shaderLocation: 3)
    if (!finalTangents) {
      console.warn(
        `[ResourceManager] Mesh "${key}" has no tangents. Creating default [1,0,0,1].`,
      );
      finalTangents = new Float32Array(finalVertexCount * 4);
      for (let i = 0; i < finalVertexCount; i++) {
        finalTangents[i * 4 + 0] = 1.0; // Tangent.x
        finalTangents[i * 4 + 1] = 0.0; // Tangent.y
        finalTangents[i * 4 + 2] = 0.0; // Tangent.z
        finalTangents[i * 4 + 3] = 1.0; // Handedness
      }
    }
    buffers[3] = createGPUBuffer(
      this.renderer.device,
      finalTangents,
      GPUBufferUsage.VERTEX,
      `${key}-tangents`,
    );
    layouts[3] = {
      arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
      stepMode: "vertex" as GPUVertexStepMode,
      attributes: [
        {
          shaderLocation: 3,
          offset: 0,
          format: "float32x4" as GPUVertexFormat,
        },
      ],
    };

    // --- NEW: Buffer 4: Texture Coordinates 1 (shaderLocation: 9) ---
    let texCoords1 = finalTexCoords1;
    if (!texCoords1 || texCoords1.length === 0) {
      texCoords1 = new Float32Array(finalVertexCount * 2);
    }
    buffers[4] = createGPUBuffer(
      this.renderer.device,
      texCoords1,
      GPUBufferUsage.VERTEX,
      `${key}-texCoords1`,
    );
    layouts[4] = {
      arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
      stepMode: "vertex" as GPUVertexStepMode,
      attributes: [
        {
          shaderLocation: 9,
          offset: 0,
          format: "float32x2" as GPUVertexFormat,
        },
      ],
    };

    const finalBuffers = buffers.filter((b) => b !== undefined) as GPUBuffer[];
    const finalLayouts = layouts.filter(
      (l) => l !== undefined,
    ) as GPUVertexBufferLayout[];

    if (finalBuffers.length !== 5 || finalLayouts.length !== 5) {
      throw new Error(
        `[ResourceManager] Mesh "${key}" must have exactly 5 vertex buffers, got ${finalBuffers.length}`,
      );
    }

    console.log(`[ResourceManager] Created mesh "${key}" with vertex layout:`);
    for (let i = 0; i < finalLayouts.length; i++) {
      const layout = finalLayouts[i];
      const attrStr = layout.attributes
        .map((a) => `@location(${a.shaderLocation}) ${a.format}`)
        .join(", ");
      console.log(
        `  Buffer ${i}: stride=${layout.arrayStride}, attrs=[${attrStr}]`,
      );
    }

    // Index buffer
    const indexBuffer = finalIndices
      ? createGPUBuffer(
          this.renderer.device,
          finalIndices,
          GPUBufferUsage.INDEX,
          `${key}-indices`,
        )
      : undefined;

    const mesh: Mesh = {
      buffers: finalBuffers,
      layouts: finalLayouts,
      vertexCount: finalVertexCount,
      indexBuffer,
      indexCount: finalIndices?.length,
      indexFormat: finalIndices instanceof Uint16Array ? "uint16" : "uint32",
      aabb,
    };

    (mesh as any).id = ResourceManager.nextMeshId++;

    let handle = key;
    if (key === "cube") handle = "PRIM:cube:size=1";
    if (key === "sphere") handle = "PRIM:icosphere:r=0.5,sub=2";
    _setHandle(mesh, handle);

    this.meshes.set(key, mesh);
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

    const mesh = await this.createMesh(meshKey, meshData);
    _setHandle(mesh, meshKey);
    return mesh;
  }
}

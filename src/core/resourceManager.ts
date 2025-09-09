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
import { generateTangents } from "mikktspace";

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
    const uvAccessor = primitive.attributes.TEXCOORD_0;
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
      uvAccessor !== undefined
        ? (getAccessorData(gltf, uvAccessor) as Float32Array)
        : new Float32Array();

    const meshData: MeshData = { positions, normals, texCoords, indices };
    const mesh = await this.createMesh(key, meshData);
    this.meshes.set(key, mesh);
    return mesh;
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
  public async createMesh(key: string, data: MeshData): Promise<Mesh> {
    if (this.meshes.has(key)) {
      return this.meshes.get(key)!;
    }

    const hasTexCoords = data.texCoords && data.texCoords.length > 0;
    // We only generate tangents if UVs are present, as they are required for the calculation.
    const needsTangents = hasTexCoords;

    let finalPositions = data.positions;
    let finalNormals = data.normals;
    let finalTexCoords = data.texCoords;
    let finalTangents: Float32Array | undefined;
    let finalIndices: Uint16Array | Uint32Array | undefined = data.indices;
    let finalVertexCount = data.positions.length / 3;

    if (needsTangents) {
      // MikkTSpace requires un-indexed geometry. We de-index the data here.
      const indexCount = data.indices.length;
      const deindexedPositions = new Float32Array(indexCount * 3);
      const deindexedNormals = new Float32Array(indexCount * 3);
      const deindexedTexCoords = new Float32Array(indexCount * 2);

      for (let i = 0; i < indexCount; i++) {
        const index = data.indices[i];
        deindexedPositions.set(
          data.positions.subarray(index * 3, index * 3 + 3),
          i * 3,
        );
        deindexedNormals.set(
          data.normals.subarray(index * 3, index * 3 + 3),
          i * 3,
        );
        if (data.texCoords) {
          deindexedTexCoords.set(
            data.texCoords.subarray(index * 2, index * 2 + 2),
            i * 2,
          );
        }
      }

      try {
        // dynamically import mikktspace to see if it causes problems
        const { generateTangents } = await import("mikktspace");

        finalTangents = generateTangents(
          deindexedPositions,
          deindexedNormals,
          deindexedTexCoords,
        );

        // The mesh data is now the de-indexed version
        finalPositions = deindexedPositions;
        finalNormals = deindexedNormals;
        finalTexCoords = deindexedTexCoords;
        finalVertexCount = indexCount;
        finalIndices = undefined; // Mark as un-indexed
      } catch (e) {
        console.error(`MikkTSpace failed for mesh "${key}". Falling back.`, e);
        // If it fails, we keep the original indexed data and won't have tangents.
        finalTangents = undefined;
      }
    }

    const buffers: GPUBuffer[] = [];
    const layouts: GPUVertexBufferLayout[] = [];

    // Compute AABB from original positions for culling
    const aabb = computeAABB(data.positions);

    // Position Buffer (shaderLocation: 0)
    buffers.push(
      createGPUBuffer(
        this.renderer.device,
        finalPositions,
        GPUBufferUsage.VERTEX,
        `${key}-positions`,
      ),
    );
    layouts.push({
      arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT,
      attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
    });

    // Normal Buffer (shaderLocation: 1)
    let normals = finalNormals;
    if (!normals || normals.length === 0) {
      console.warn(`Mesh "${key}" is missing normals. Generating dummy data.`);
      normals = new Float32Array(finalVertexCount * 3);
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
      arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT,
      attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
    });

    // Texture Coordinate (UVs) Buffer (shaderLocation: 2)
    let texCoords = finalTexCoords;
    if (!texCoords || texCoords.length === 0) {
      texCoords = new Float32Array(finalVertexCount * 2);
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
      arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
      attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }],
    });

    // Tangent Buffer (shaderLocation: 3) - Only if generated
    if (finalTangents) {
      buffers.push(
        createGPUBuffer(
          this.renderer.device,
          finalTangents,
          GPUBufferUsage.VERTEX,
          `${key}-tangents`,
        ),
      );
      layouts.push({
        arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT, // vec4<f32>
        attributes: [{ shaderLocation: 3, offset: 0, format: "float32x4" }],
      });
    }

    // Index buffer (optional now)
    const indexBuffer = finalIndices
      ? createGPUBuffer(
          this.renderer.device,
          finalIndices,
          GPUBufferUsage.INDEX,
          `${key}-indices`,
        )
      : undefined;

    const mesh: Mesh = {
      buffers,
      layouts,
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

    const mesh = await this.createMesh(meshKey, meshData);
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

    const mesh = await this.createMesh(meshKey, meshData);
    _setHandle(mesh, meshKey);
    return mesh;
  }
}

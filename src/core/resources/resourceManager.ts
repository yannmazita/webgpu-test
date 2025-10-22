// src/core/resourceManager.ts
import { Renderer } from "@/core/rendering/renderer";
import {
  Mesh,
  PBRMaterialOptions,
  UnlitGroundMaterialOptions,
} from "@/core/types/gpu";
import { MeshData } from "@/core/types/mesh";
import { loadOBJ } from "@/loaders/objLoader";
import { loadSTL } from "@/loaders/stlLoader";

import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import { PBRMaterial } from "@/core/materials/pbrMaterial";
import {
  createConeMeshData,
  createCubeMeshData,
  createCylinderMeshData,
  createIcosphereMeshData,
  createPlaneMeshData,
  createTorusMeshData,
  createUvSphereMeshData,
} from "@/core/utils/primitives";
import { IBLComponent } from "@/core/ecs/components/iblComponent";
import { getSupportedCompressedFormats } from "@/core/utils/webgpu";
import { initBasis } from "@/core/wasm/basisModule";
import {
  decodeMeshopt,
  dequantize,
  getAccessorData,
  GLTFPrimitive,
  loadGLTF,
  ParsedGLTF,
} from "@/loaders/gltfLoader";
import { Entity } from "@/core/ecs/entity";
import { World } from "@/core/ecs/world";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { initMeshopt } from "@/core/wasm/meshoptimizerModule";
import { ResourceHandle } from "@/core/resources/resourceHandle";
import { MeshFactory } from "@/core/resources/meshFactory";
import { MaterialFactory } from "@/core/resources/materialFactory";
import { GltfSceneLoader } from "@/loaders/gltfSceneLoader";
import { IblGenerator } from "../rendering/iblGenerator";
import {
  MaterialInstanceCache,
  MaterialTemplateCache,
  MeshCache,
  SamplerCache,
} from "./resourceCache";

/**
 * Defines the declarative specification for a PBR material.
 *
 * @remarks
 * This interface is used for creating materials from scene files or code,
 * providing a high-level description that can be resolved into a concrete
 * MaterialInstance.
 */
export interface PBRMaterialSpec {
  type: "PBR";
  options: PBRMaterialOptions;
}

/**
 * Represents a complete environment map, including its skybox and IBL data.
 */
export interface EnvironmentMap {
  skyboxMaterial: MaterialInstance;
  iblComponent: IBLComponent;
}

/**
 * Parses parameters from a primitive handle key.
 * Example: "size=2.5,sub=3" -> Map { "size": 2.5, "sub": 3 }
 * @param key The part of the handle key after the primitive name and colon.
 * @returns A map of parameter names to their numeric values.
 */
function parsePrimParams(key: string): Map<string, number> {
  const params = new Map<string, number>();
  if (!key) return params;

  key.split(",").forEach((part) => {
    const [name, value] = part.split("=");
    if (name && value) {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        params.set(name.trim(), numValue);
      }
    }
  });
  return params;
}

/**
 * Manages the creation, loading, and caching of engine resources.
 *
 * @remarks
 * This class acts as a central hub for all resource-related operations. It
 * coordinates with various loaders and factories to abstract away the
 * complexities of resource creation and management. It ensures that resources
 * are loaded only once and are efficiently reused throughout the engine.
 */
export class ResourceManager {
  private static nextMeshId = 0;
  private renderer: Renderer;
  private dummyTexture!: GPUTexture;
  private defaultSampler!: GPUSampler;
  private preprocessor: ShaderPreprocessor;
  private brdfLut: GPUTexture | null = null;
  private supportedCompressedFormats: Set<GPUTextureFormat>;
  private iblGenerator: IblGenerator | null = null;

  private materialTemplateCache = new MaterialTemplateCache();
  private meshCache = new MeshCache();
  private samplerCache = new SamplerCache();
  private materialInstanceCache = new MaterialInstanceCache();

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.preprocessor = new ShaderPreprocessor();
    this.supportedCompressedFormats = getSupportedCompressedFormats(
      this.renderer.device,
    );
    console.log(
      "[ResourceManager] Supported compressed formats:",
      this.supportedCompressedFormats,
    );
    this.createDefaultResources();
    initBasis("/basis_transcoder.wasm").catch((e) =>
      console.error("Failed to initialize Basis transcoder", e),
    ); // the wasm file is in the public dir, so root of the page
  }

  private createDefaultResources(): void {
    this.dummyTexture = this.renderer.device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.renderer.device.queue.writeTexture(
      { texture: this.dummyTexture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );
    this.defaultSampler = this.renderer.device.createSampler({
      label: "DEFAULT_SAMPLER_(GLTF_COMPLIANT)",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });
  }

  /**
   * Retrieves or creates a cached GPUSampler from a glTF sampler definition.
   *
   * @remarks
   * This method ensures that samplers with identical properties are not
   * duplicated. It translates glTF numeric codes into WebGPU string enums
   * and uses a string-based key for efficient caching.
   *
   * @param gltf The parsed glTF asset.
   * @param samplerIndex The optional index of the sampler in the glTF file.
   * If undefined, the default sampler is returned.
   * @returns A GPUSampler matching the definition, or a default sampler.
   */
  public getGLTFSampler(gltf: ParsedGLTF, samplerIndex?: number): GPUSampler {
    if (samplerIndex === undefined) {
      return this.defaultSampler;
    }

    const gltfSampler = gltf.json.samplers?.[samplerIndex];
    if (!gltfSampler) {
      console.warn(
        `[ResourceManager] glTF sampler index ${samplerIndex} not found. Using default.`,
      );
      return this.defaultSampler;
    }

    // Create a cache key from the sampler properties
    const key =
      `${gltfSampler.magFilter ?? "L"}|${gltfSampler.minFilter ?? "L"}|` +
      `${gltfSampler.wrapS ?? "R"}|${gltfSampler.wrapT ?? "R"}`;

    // Check cache first
    const cached = this.samplerCache.getByKey(key);
    if (cached) {
      return cached;
    }

    // Helper to map glTF wrap modes to WebGPU
    const getAddressMode = (mode?: number): GPUAddressMode => {
      switch (mode) {
        case 10497: // REPEAT
          return "repeat";
        case 33071: // CLAMP_TO_EDGE
          return "clamp-to-edge";
        case 33648: // MIRRORED_REPEAT
          return "mirror-repeat";
        default:
          return "repeat"; // glTF default
      }
    };

    // Helper to map glTF filter modes to WebGPU
    const getFilterMode = (mode?: number): GPUFilterMode => {
      switch (mode) {
        case 9728: // NEAREST
        case 9984: // NEAREST_MIPMAP_NEAREST
        case 9986: // NEAREST_MIPMAP_LINEAR
          return "nearest";
        case 9729: // LINEAR
        case 9985: // LINEAR_MIPMAP_NEAREST
        case 9987: // LINEAR_MIPMAP_LINEAR
          return "linear";
        default:
          return "linear"; // glTF default
      }
    };

    // Helper to map glTF min filter to WebGPU mipmap filter
    const getMipmapFilterMode = (mode?: number): GPUMipmapFilterMode => {
      switch (mode) {
        case 9984: // NEAREST_MIPMAP_NEAREST
        case 9985: // LINEAR_MIPMAP_NEAREST
          return "nearest";
        case 9986: // NEAREST_MIPMAP_LINEAR
        case 9987: // LINEAR_MIPMAP_LINEAR
          return "linear";
        default:
          return "linear"; // Default for quality
      }
    };

    const newSampler = this.renderer.device.createSampler({
      label: `GLTF_SAMPLER_${key}`,
      addressModeU: getAddressMode(gltfSampler.wrapS),
      addressModeV: getAddressMode(gltfSampler.wrapT),
      magFilter: getFilterMode(gltfSampler.magFilter),
      minFilter: getFilterMode(gltfSampler.minFilter),
      mipmapFilter: getMipmapFilterMode(gltfSampler.minFilter),
    });

    // Store in cache
    this.samplerCache.set(key, newSampler);
    return newSampler;
  }

  /**
   * Retrieves the resource handle associated with a given mesh object.
   *
   * @remarks
   * This allows for reverse lookups, which can be useful for serialization or
   * debugging to identify how a specific mesh was originally created.
   *
   * @param mesh The mesh object whose handle is to be retrieved.
   * @returns The handle if the mesh is managed, otherwise undefined.
   */
  public getHandleForMesh(mesh: Mesh): ResourceHandle<Mesh> | undefined {
    return this.meshCache.getHandle(mesh);
  }

  /**
   * Synchronously retrieves a pre-loaded mesh from the cache.
   *
   * @param handle The handle of the mesh to retrieve.
   * @returns The Mesh object if cached, otherwise undefined.
   */
  public getMeshByHandleSync(handle: ResourceHandle<Mesh>): Mesh | undefined {
    return this.meshCache.get(handle);
  }

  /**
   * Synchronously retrieves a pre-loaded material instance from the cache.
   *
   * @param handle The handle of the material instance to retrieve.
   * @returns The MaterialInstance if cached, otherwise undefined.
   */
  public getMaterialInstanceByHandleSync(
    handle: ResourceHandle<MaterialInstance>,
  ): MaterialInstance | undefined {
    return this.materialInstanceCache.get(handle);
  }

  /**
   * Retrieves the PBR material specification used to create a material instance.
   *
   * @remarks
   * This is primarily used for serialization, allowing the engine to save the
   * high-level description of a material (ie colors, texture URLs) rather
   * than its GPU-specific state. The association is created when a material is
   * resolved via `resolveMaterialSpec`.
   *
   * @param material The material instance to query.
   * @return The specification object if one was
   *     used to create the instance, otherwise undefined.
   */
  public getMaterialSpec(
    material: MaterialInstance,
  ): PBRMaterialSpec | undefined {
    return this.materialInstanceCache.getMaterialSpec(material);
  }

  /**
   * Creates or retrieves a cached PBR material template.
   *
   * @remarks
   * Material templates define the shader and pipeline for a class of materials
   * (like opaque vs. transparent), avoiding redundant shader compilation.
   *
   * @param options Material properties, used to determine the template type.
   * @returns A promise that resolves to a cached or newly created PBRMaterial.
   */
  public async createPBRMaterialTemplate(
    options: PBRMaterialOptions = {},
  ): Promise<PBRMaterial> {
    const albedo = options.albedo ?? [1, 1, 1, 1];
    const isTransparent = albedo[3] < 1.0;
    const templateKey = `PBR_TEMPLATE:${isTransparent}`;

    const cached = this.materialTemplateCache.getByKey(templateKey);
    if (cached) return cached as PBRMaterial;

    const materialTemplate = await MaterialFactory.createPBRTemplate(
      this.renderer.device,
      this.preprocessor,
      options,
    );

    this.materialTemplateCache.set(templateKey, materialTemplate);
    return materialTemplate;
  }

  /**
   * Creates a unique PBR material instance from a template and options.
   *
   * @remarks
   * This method orchestrates the creation of a MaterialInstance by delegating
   * to the MaterialFactory, providing necessary context like default samplers.
   *
   * @param materialTemplate The shared PBRMaterial template.
   * @param options Specific properties for this instance (colors, textures).
   * @param sampler The sampler to use for the material's textures.
   * @returns A promise that resolves to a new MaterialInstance.
   */
  public async createPBRMaterialInstance(
    materialTemplate: PBRMaterial,
    options: PBRMaterialOptions = {},
    sampler?: GPUSampler,
  ): Promise<MaterialInstance> {
    const finalSampler = sampler ?? this.defaultSampler;

    return MaterialFactory.createPBRInstance(
      this.renderer.device,
      this.supportedCompressedFormats,
      this.dummyTexture,
      materialTemplate,
      options,
      finalSampler,
    );
  }

  /**
   * Creates or retrieves an instance of the UnlitGroundMaterial.
   *
   * @remarks
   * This is a specialized, performant shader for rendering grids or ground planes.
   * Instances are cached based on their options to prevent duplication.
   *
   * @param options The configuration for the ground material.
   * @returns A promise resolving to a cached or new MaterialInstance.
   */
  public async createUnlitGroundMaterial(
    options: UnlitGroundMaterialOptions,
  ): Promise<MaterialInstance> {
    const colorKey = options.color ? options.color.join(",") : "";
    const instanceKey = `UNLIT_GROUND_INSTANCE:${options.textureUrl ?? ""}:${colorKey}`;

    const cached = this.materialInstanceCache.getByKey(instanceKey);
    if (cached) return cached;

    const instance = await MaterialFactory.createUnlitGroundMaterial(
      this.renderer.device,
      this.preprocessor,
      this.dummyTexture,
      this.defaultSampler,
      options,
    );

    this.materialInstanceCache.set(instanceKey, instance);
    return instance;
  }

  /**
   * Creates a complete environment map from an equirectangular image URL.
   *
   * @remarks
   * Orchestrates the IBL generation process, including the BRDF lookup table,
   * skybox cubemap, and diffuse irradiance/prefiltered specular maps.
   *
   * @param url The URL of the `.hdr` or `.exr` file.
   * @param cubemapSize The resolution for the generated cubemap faces.
   * @returns A promise resolving to an EnvironmentMap object.
   */
  public async createEnvironmentMap(
    url: string,
    cubemapSize = 512,
  ): Promise<EnvironmentMap> {
    // Lazily initialize the IBL generator and its pipelines once.
    if (!this.iblGenerator) {
      this.iblGenerator = new IblGenerator(
        this.renderer.device,
        this.preprocessor,
      );
      await this.iblGenerator.initialize();
    }

    const result = await this.iblGenerator.generate({
      url: url,
      cubemapSize: cubemapSize,
      brdfLut: this.brdfLut,
    });

    // Cache the BRDF LUT as it is scene-independent.
    this.brdfLut = result.brdfLut;

    return {
      skyboxMaterial: result.skyboxMaterial,
      iblComponent: result.iblComponent,
    };
  }

  /**
   * Resolves a high-level material specification into a renderable instance.
   *
   * @remarks
   * This serves as an abstraction for material creation, typically used when
   * loading scenes. It interprets the spec, creates the instance, and caches it.
   *
   * @param spec The declarative description of the material.
   * @param cacheKey An optional key to cache the created instance.
   * @returns A promise that resolves to a new MaterialInstance.
   */
  public async resolveMaterialSpec(
    spec: PBRMaterialSpec,
    cacheKey?: string,
  ): Promise<MaterialInstance> {
    if (cacheKey) {
      const cached = this.materialInstanceCache.getByKey(cacheKey);
      if (cached) return cached;
    }

    if (!spec || spec.type !== "PBR") {
      throw new Error("Unsupported material spec (expected type 'PBR').");
    }

    const template = await this.createPBRMaterialTemplate(spec.options);
    const instance = await this.createPBRMaterialInstance(
      template,
      spec.options,
      this.defaultSampler,
    );

    // Store the spec with the instance for serialization
    const finalKey = cacheKey ?? `PBR_INSTANCE:${Date.now()}_${Math.random()}`;
    this.materialInstanceCache.set(finalKey, instance, undefined, spec);

    return instance;
  }

  /**
   * Retrieves or creates a mesh from a resource handle.
   *
   * @remarks
   * This is the primary method for loading mesh assets. It uses the handle's
   * key to cache results and determines the correct loader based on the key format
   *
   * Supported handle key formats:
   * - `"PRIM:cube:size=2.5"`
   * - `"PRIM:plane:size=10"`
   * - `"PRIM:icosphere:r=1.0,sub=3"`
   * - `"PRIM:uvsphere:r=1.0,sub=32"`
   * - `"PRIM:cylinder:r=0.5,h=2,sub=32"`
   * - `"PRIM:cone:r=0.5,h=2,sub=32"`
   * - `"PRIM:torus:r=1,tube=0.4,rseg=16,tseg=32"`
   * - `"OBJ:path/to/model.obj"`
   * - `"STL:path/to/model.stl"`
   * - `"GLTF:path/to/model.gltf#meshName"`
   *
   * @param handle The typed handle identifying the mesh.
   * @return A promise that resolves to the requested `Mesh` object.
   * @throws If the handle's key format is unsupported or the asset is not found.
   */
  public async resolveMeshByHandle(
    handle: ResourceHandle<Mesh>,
  ): Promise<Mesh | null> {
    const key = handle.key;

    // Check cache first
    const cached = this.meshCache.get(handle);
    if (cached) return cached;

    let meshData: MeshData | null = null;
    const [type, ...rest] = key.split(":");
    const paramString = rest.join(":");

    if (type === "PRIM") {
      const name = paramString.substring(0, paramString.indexOf(":"));
      const params = parsePrimParams(
        paramString.substring(paramString.indexOf(":") + 1),
      );

      switch (name) {
        case "cube": {
          const size = params.get("size") ?? 1.0;
          meshData = createCubeMeshData(size);
          break;
        }
        case "plane": {
          const size = params.get("size") ?? 1.0;
          meshData = createPlaneMeshData(size);
          break;
        }
        case "icosphere": {
          const r = params.get("r") ?? 0.5;
          const sub = params.get("sub") ?? 2;
          meshData = createIcosphereMeshData(r, sub);
          break;
        }
        case "uvsphere": {
          const r = params.get("r") ?? 0.5;
          const sub = params.get("sub") ?? 16;
          meshData = createUvSphereMeshData(r, sub);
          break;
        }
        case "cylinder": {
          const r = params.get("r") ?? 0.5;
          const h = params.get("h") ?? 1.0;
          const sub = params.get("sub") ?? 32;
          meshData = createCylinderMeshData(r, h, sub);
          break;
        }
        case "cone": {
          const r = params.get("r") ?? 0.5;
          const h = params.get("h") ?? 1.0;
          const sub = params.get("sub") ?? 32;
          meshData = createConeMeshData(r, h, sub);
          break;
        }
        case "torus": {
          const r = params.get("r") ?? 0.5;
          const tube = params.get("tube") ?? 0.2;
          const rseg = params.get("rseg") ?? 16;
          const tseg = params.get("tseg") ?? 32;
          meshData = createTorusMeshData(r, tube, rseg, tseg);
          break;
        }
      }
    }

    let mesh: Mesh | null;
    if (meshData) {
      mesh = await this.createMesh(key, meshData);
    } else if (key.startsWith("OBJ:")) {
      const url = key.substring(4);
      mesh = (await this.loadMeshFromOBJ(url)) ?? null;
    } else if (key.startsWith("STL:")) {
      const url = key.substring(4);
      mesh = (await this.loadMeshFromSTL(url)) ?? null;
    } else if (key.startsWith("GLTF:")) {
      const parts = key.substring(5).split("#");
      const url = parts[0];
      const meshName = parts[1];
      if (!meshName) {
        throw new Error(
          "GLTF mesh handle requires a mesh name: GLTF:url#meshName",
        );
      }
      const { parsedGltf } = await loadGLTF(url);
      const gltfMesh = parsedGltf.json.meshes?.find((m) => m.name === meshName);
      if (!gltfMesh || gltfMesh.primitives.length === 0) {
        throw new Error(
          `Mesh "${meshName}" not found or has no primitives in ${url}`,
        );
      }
      const primitive = gltfMesh.primitives[0];
      mesh = await this.createMeshFromPrimitive(key, parsedGltf, primitive);
    } else {
      throw new Error(`Unsupported mesh handle: ${key}`);
    }

    if (mesh) {
      // Store in cache with the provided handle
      this.meshCache.set(key, mesh, handle);
    }
    return mesh;
  }

  /**
   * Loads a glTF file and instantiates its scene graph into the ECS world.
   *
   * @param world The World instance where the scene entities will be created.
   * @param url The URL of the `.gltf` or `.glb` file to load.
   * @returns A promise that resolves to the root Entity of the new hierarchy.
   */
  public async loadSceneFromGLTF(world: World, url: string): Promise<Entity> {
    const { parsedGltf, baseUri } = await loadGLTF(url);
    const sceneLoader = new GltfSceneLoader(world, this);
    return sceneLoader.load(parsedGltf, baseUri);
  }

  /**
   * Creates a Mesh from a single glTF primitive.
   *
   * This method acts as a bridge between the glTF data structure and the engine's
   * internal Mesh representation. It extracts vertex data (positions, normals,
   * etc.) and index data from the provided primitive, constructs an intermediate
   * `MeshData` object, and then delegates to the internal `createMesh` method
   * for GPU buffer creation.
   *
   * @remarks
   * This function handles several key aspects of glTF geometry processing:
   * - **Caching**: It first checks if a mesh for the given `key` already exists
   *   in the cache to avoid redundant processing.
   * - **Compression**: It supports primitives compressed with the
   *   `EXT_meshopt_compression` extension, decoding the data before use.
   * - **Attribute Extraction**: It reads standard attributes like
   *   `POSITION`, `NORMAL`, `TEXCOORD_0`, and `TEXCOORD_1`.
   * - **Dequantization**: If vertex attributes are stored in a normalized integer
   *   format (ie `accessor.normalized = true`), this method dequantizes
   *   them into 32-bit floats.
   * - **Indexing**: It requires that all primitives be indexed. Primitives
   *   without an `indices` accessor will throw an error.
   *
   * @param key A unique string identifier used for caching the resulting mesh.
   * @param gltf The complete parsed glTF asset, used to access buffers and accessors.
   * @param primitive The specific glTF primitive object to process.
   * @returns A promise that resolves to the created or cached `Mesh` object.
   * @throws If the primitive is not indexed (ie `primitive.indices` is undefined).
   * @throws If the primitive is missing the required `POSITION` vertex attribute.
   */
  public async createMeshFromPrimitive(
    key: string,
    gltf: ParsedGLTF,
    primitive: GLTFPrimitive,
  ): Promise<Mesh> {
    const cachedMesh = this.meshCache.getByKey(key);
    if (cachedMesh) {
      return cachedMesh;
    }

    if (primitive.indices === undefined) {
      throw new Error(`GLTF primitive for mesh "${key}" must be indexed.`);
    }

    let positions: Float32Array | undefined;
    let normals: Float32Array | undefined;
    let texCoords: Float32Array | undefined;
    let texCoords1: Float32Array | undefined;
    let indices: Uint16Array | Uint32Array | undefined;

    const isCompressed = !!primitive.extensions?.EXT_meshopt_compression;

    if (isCompressed) {
      await initMeshopt();
      const decodedData = decodeMeshopt(gltf, primitive);
      indices = decodedData.indexData;
      if (!indices) {
        throw new Error(
          `Failed to decode indices for compressed GLTF primitive in "${key}".`,
        );
      }

      for (const [attributeName, rawData] of Object.entries(
        decodedData.vertexData,
      )) {
        const accessorIndex = primitive.attributes[attributeName];
        if (gltf.json.accessors) {
          const accessor = gltf.json.accessors[accessorIndex];
          let finalData: Float32Array;

          if (accessor.normalized) {
            finalData = dequantize(rawData, accessor);
          } else if (rawData instanceof Float32Array) {
            finalData = rawData;
          } else {
            finalData = new Float32Array(rawData);
          }

          switch (attributeName) {
            case "POSITION":
              positions = finalData;
              break;
            case "NORMAL":
              normals = finalData;
              break;
            case "TEXCOORD_0":
              texCoords = finalData;
              break;
            case "TEXCOORD_1":
              texCoords1 = finalData;
              break;
          }
        }
      }
    } else {
      const getAttribute = (
        attributeName: string,
      ): Float32Array | undefined => {
        const accessorIndex = primitive.attributes[attributeName];
        if (accessorIndex === undefined) return undefined;
        if (gltf.json.accessors) {
          const accessor = gltf.json.accessors[accessorIndex];
          const rawData = getAccessorData(gltf, accessorIndex);
          if (accessor.normalized) return dequantize(rawData, accessor);
          return rawData instanceof Float32Array
            ? rawData
            : new Float32Array(rawData);
        }
        return undefined;
      };

      positions = getAttribute("POSITION");
      normals = getAttribute("NORMAL");
      texCoords = getAttribute("TEXCOORD_0");
      texCoords1 = getAttribute("TEXCOORD_1");
      indices = getAccessorData(gltf, primitive.indices) as
        | Uint16Array
        | Uint32Array;
    }

    if (!positions) {
      throw new Error(
        `GLTF primitive in "${key}" must have POSITION attribute.`,
      );
    }

    const meshData: MeshData = {
      positions: positions,
      normals: normals ?? new Float32Array(),
      texCoords: texCoords ?? new Float32Array(),
      texCoords1: texCoords1 ?? new Float32Array(),
      indices: indices,
    };
    return this.createMesh(key, meshData);
  }

  /**
   * Creates a new mesh from raw mesh data, delegating to the MeshFactory.
   *
   * @remarks
   * This is a low-level method that takes processed mesh data and creates the
   * necessary GPU buffers, caching the result.
   *
   * @param key A unique key to identify the mesh in the cache.
   * @param data The raw mesh data (positions, normals, etc.).
   * @returns A promise that resolves to the created Mesh.
   */
  public async createMesh(key: string, data: MeshData): Promise<Mesh> {
    // Check cache first
    const cached = this.meshCache.getByKey(key);
    if (cached) return cached;

    const mesh: Mesh & { id?: number } = await MeshFactory.createMesh(
      this.renderer.device,
      key,
      data,
    );

    mesh.id = ResourceManager.nextMeshId++;

    // Store in cache with auto-generated handle
    this.meshCache.set(key, mesh);

    return mesh;
  }

  /**
   * Loads, parses, and creates a mesh from an OBJ file.
   *
   * @param url The URL of the .obj file.
   * @returns A promise that resolves to the created or cached Mesh.
   */
  public async loadMeshFromOBJ(url: string): Promise<Mesh | null> {
    const meshKey = `OBJ:${url}`;

    const cached = this.meshCache.getByKey(meshKey);
    if (cached) return cached;

    const objGeometry = await loadOBJ(url);
    const meshData: MeshData = {
      positions: objGeometry.vertices,
      normals: objGeometry.normals,
      indices: objGeometry.indices,
      texCoords: objGeometry.uvs,
    };

    const mesh = await this.createMesh(meshKey, meshData);
    return mesh;
  }

  /**
   * Loads, parses, and creates a mesh from an STL file.
   *
   * @param url The URL of the .stl file.
   * @returns A promise that resolves to the created or cached Mesh.
   */
  public async loadMeshFromSTL(url: string): Promise<Mesh | null> {
    const meshKey = `STL:${url}`;

    const cached = this.meshCache.getByKey(meshKey);
    if (cached) return cached;

    const stlGeometry = await loadSTL(url);
    const meshData: MeshData = {
      positions: stlGeometry.vertices,
      normals: stlGeometry.normals,
      indices: stlGeometry.indices,
    };
    const mesh = await this.createMesh(meshKey, meshData);
    return mesh;
  }
}

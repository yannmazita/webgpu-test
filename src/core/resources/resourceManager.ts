// src/core/resourceManager.ts
import { Renderer } from "@/core/rendering/renderer";
import { Material } from "@/core/materials/material";
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
  createCubeMeshData,
  createIcosphereMeshData,
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

export interface PBRMaterialSpec {
  type: "PBR";
  options: PBRMaterialOptions;
}

export interface EnvironmentMap {
  skyboxMaterial: MaterialInstance;
  iblComponent: IBLComponent;
}

/**
 * Manages the creation, loading, and caching of GPU resources.
 * It acts as a coordinator, delegating resource creation to specialized
 * factories and loaders.
 */
export class ResourceManager {
  private static nextMeshId = 0;
  private renderer: Renderer;
  private materials = new Map<string, Material>();
  private meshes = new Map<string, Mesh>();
  private dummyTexture!: GPUTexture;
  private defaultSampler!: GPUSampler;
  private samplerCache = new Map<string, GPUSampler>();
  private preprocessor: ShaderPreprocessor;
  private brdfLut: GPUTexture | null = null;
  private supportedCompressedFormats: Set<GPUTextureFormat>;
  private iblGenerator: IblGenerator | null = null;
  private meshToHandle = new WeakMap<Mesh, ResourceHandle<Mesh>>();
  private materialInstanceToSpec = new WeakMap<
    MaterialInstance,
    PBRMaterialSpec
  >();

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
   * Retrieves or creates a cached GPUSampler based on a glTF sampler
   * definition.
   *
   * @remarks
   * This method ensures that samplers with identical properties (filter modes,
   * wrap modes) are not duplicated. It translates the numeric codes from the
   * glTF file into the string enums required by the WebGPU API and uses a
   * string-based key for efficient caching.
   *
   * @param gltf The parsed glTF asset.
   * @param samplerIndex Optional, the index of the sampler in the glTF's
   *     `samplers` array. If undefined, the default sampler is returned.
   * @returns A GPUSampler matching the glTF definition, or the
   *     default sampler if the index is invalid.
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

    const cached = this.samplerCache.get(key);
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

    this.samplerCache.set(key, newSampler);
    return newSampler;
  }

  /**
   * Retrieves the resource handle associated with a given mesh object.
   *
   * @remarks
   * This allows for reverse lookups, which can be useful for serialization or
   * debugging to identify how a specific mesh was originally created. The
   * association is created when a mesh is successfully resolved via
   * `resolveMeshByHandle`.
   *
   * @param mesh The mesh object whose handle is to be retrieved.
   * @return The handle if the mesh is managed by the resource manager,
   *    otherwise undefined.
   */
  public getHandleForMesh(mesh: Mesh): ResourceHandle<Mesh> | undefined {
    return this.meshToHandle.get(mesh);
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
    return this.materialInstanceToSpec.get(material);
  }

  /**
   * Creates or retrieves a cached PBR material template.
   *
   * @remarks
   * Material templates are shared `PBRMaterial` objects that define the shader
   * and pipeline layout for a class of materials (ie opaque vs.
   * transparent). This avoids redundant shader compilation. The actual per-object
   * properties are stored in a `MaterialInstance` created from the template.
   *
   * Caching is based on the material's alpha mode.
   *
   * @param An object containing material
   *     properties. Only the alpha value of the `albedo` property is used to
   *     determine the template type (opaque or transparent).
   * @return A promise that resolves to a cached or newly
   *     created `PBRMaterial` template.
   */
  public async createPBRMaterialTemplate(
    options: PBRMaterialOptions = {},
  ): Promise<PBRMaterial> {
    const albedo = options.albedo ?? [1, 1, 1, 1];
    const isTransparent = albedo[3] < 1.0;
    const templateKey = `PBR_TEMPLATE:${isTransparent}`;
    const cached = this.materials.get(templateKey);
    if (cached) return cached as PBRMaterial;

    const materialTemplate = await MaterialFactory.createPBRTemplate(
      this.renderer.device,
      this.preprocessor,
      options,
    );
    this.materials.set(templateKey, materialTemplate);
    return materialTemplate;
  }

  /**
   * Creates a unique PBR material instance from a template and a set of options.
   *
   * @remarks
   * This method orchestrates the creation of a `MaterialInstance` by delegating
   * to the `MaterialFactory`. It is responsible for providing the factory with
   * the necessary context, such as the default sampler and supported texture
   * formats. The resulting instance will have its own uniform buffer and
   * bind group, ready for rendering.
   *
   * @param materialTemplate The shared `PBRMaterial` template.
   * @param [options={}] An object containing specific
   *     properties for this instance (e.g., colors, texture URLs).
   * @param [sampler] The sampler to use for the material's
   *     textures. If not provided, the resource manager's default sampler is used.
   * @return A promise that resolves to a new
   *     `MaterialInstance`.
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
   * Creates an instance of the UnlitGroundMaterial.
   *
   * @remarks
   * This material is a specialized, performant shader for rendering grids or
   * ground planes and is not part of the PBR system. Instances are cached based
   * on their options to prevent duplication.
   *
   * @param options The configuration for the
   *     ground material, such as color, texture, and grid properties.
   * @return  A promise that resolves to a cached or newly created `MaterialInstance`.
   */
  public async createUnlitGroundMaterial(
    options: UnlitGroundMaterialOptions,
  ): Promise<MaterialInstance> {
    const colorKey = options.color ? options.color.join(",") : "";
    const instanceKey = `UNLIT_GROUND_INSTANCE:${options.textureUrl ?? ""}:${colorKey}`;

    const cached = this.materials.get(instanceKey);
    if (cached && cached instanceof MaterialInstance) {
      return cached;
    }

    const instance = await MaterialFactory.createUnlitGroundMaterial(
      this.renderer.device,
      this.preprocessor,
      this.dummyTexture,
      this.defaultSampler,
      options,
    );

    this.materials.set(instanceKey, instance as unknown as Material);
    return instance;
  }

  /**
   * Creates a complete environment map and IBL probe from an equirectangular image URL.
   *
   * This method orchestrates the IBL generation process by delegating to the
   * `IblGenerator`. It is also responsible for caching the BRDF lookup table,
   * as it is scene-independent and can be reused for all environment maps.
   *
   * @param url The URL of the `.hdr` or `.exr` file.
   * @param cubemapSize The desired resolution for the generated cubemap faces (e.g., 512).
   * @returns A promise that resolves to an `EnvironmentMap` object containing the
   *     skybox material and the IBL component.
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
   * Resolves a high-level material specification into a renderable material instance.
   *
   * @remarks
   * This method serves as an abstraction layer for material creation, typically
   * used when loading scenes from a file. It interprets the `PBRMaterialSpec`,
   * creates the necessary template and instance, and associates the spec with the
   * final instance for later serialization via `getMaterialSpec`.
   *
   * @param spec The declarative description of the material.
   * @return A promise that resolves to a new`MaterialInstance`.
   * @throws If the specification type is unsupported.
   */
  public async resolveMaterialSpec(
    spec: PBRMaterialSpec,
  ): Promise<MaterialInstance> {
    if (!spec || spec.type !== "PBR") {
      throw new Error("Unsupported material spec (expected type 'PBR').");
    }
    const template = await this.createPBRMaterialTemplate(spec.options);
    const instance = await this.createPBRMaterialInstance(
      template,
      spec.options,
      this.defaultSampler,
    );
    // Associate the spec with the instance for serialization
    this.materialInstanceToSpec.set(instance, spec);
    return instance;
  }

  /**
   * Retrieves or creates a mesh from a resource handle.
   *
   * @remarks
   * This is the primary method for loading mesh assets. It uses the handle's
   * key to cache results, ensuring that the same mesh is not loaded or processed
   * multiple times. The method determines the correct loader (ie for OBJ,
   * GLTF, or procedural primitives) based on the handle's key format.
   *
   * Supported handle key formats:
   * - `"PRIM:cube:size=2.5"`
   * - `"PRIM:icosphere:r=1.0,sub=3"`
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
  ): Promise<Mesh> {
    const key = handle.key;
    const cached = this.meshes.get(key);
    if (cached) return cached;

    let mesh: Mesh;
    if (key.startsWith("PRIM:cube")) {
      let size = 1.0;
      const m = /size=([0-9]*\.?[0-9]+)/.exec(key);
      if (m) size = parseFloat(m[1]);
      const data = createCubeMeshData(size);
      mesh = await this.createMesh(key, data);
    } else if (key.startsWith("PRIM:icosphere")) {
      let r = 0.5,
        sub = 2;
      const rm = /r=([0-9]*\.?[0-9]+)/.exec(key);
      const sm = /sub=([0-9]+)/.exec(key);
      if (rm) r = parseFloat(rm[1]);
      if (sm) sub = parseInt(sm[1], 10);
      const data = createIcosphereMeshData(r, sub);
      mesh = await this.createMesh(key, data);
    } else if (key.startsWith("OBJ:")) {
      const url = key.substring(4);
      mesh = await this.loadMeshFromOBJ(url);
    } else if (key.startsWith("STL:")) {
      const url = key.substring(4);
      mesh = await this.loadMeshFromSTL(url);
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

    this.meshes.set(key, mesh);
    this.meshToHandle.set(mesh, handle);
    return mesh;
  }

  /**
   * Loads a glTF file and instantiates its scene graph into the ECS world.
   * This method delegates the complex instantiation logic to the GltfSceneLoader.
   *
   * @param world The `World` instance where the scene entities will be created.
   * @param url The URL of the `.gltf` or `.glb` file to load.
   * @return A promise that resolves to the root `Entity` of the newly created scene hierarchy.
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
    const cachedMesh = this.meshes.get(key);
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
        const accessor = gltf.json.accessors![accessorIndex];
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
    } else {
      const getAttribute = (
        attributeName: string,
      ): Float32Array | undefined => {
        const accessorIndex = primitive.attributes[attributeName];
        if (accessorIndex === undefined) return undefined;
        const accessor = gltf.json.accessors![accessorIndex];
        const rawData = getAccessorData(gltf, accessorIndex);
        if (accessor.normalized) return dequantize(rawData, accessor);
        return rawData instanceof Float32Array
          ? rawData
          : new Float32Array(rawData);
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
      positions: positions!,
      normals: normals ?? new Float32Array(),
      texCoords: texCoords ?? new Float32Array(),
      texCoords1: texCoords1 ?? new Float32Array(),
      indices: indices!,
    };
    return this.createMesh(key, meshData);
  }

  /**
   * Creates a new mesh from the given mesh data by delegating to MeshFactory.
   * This is a low-level method that takes raw mesh data and creates the
   * necessary GPU buffers.
   * @param key A unique key to identify the mesh in the cache.
   * @param data The mesh data.
   * @returns The created mesh.
   */
  private async createMesh(key: string, data: MeshData): Promise<Mesh> {
    const cachedMesh = this.meshes.get(key);
    if (cachedMesh) {
      return cachedMesh;
    }

    const mesh: Mesh & { id?: number } = await MeshFactory.createMesh(
      this.renderer.device,
      key,
      data,
    );

    mesh.id = ResourceManager.nextMeshId++;
    this.meshes.set(key, mesh);

    // The handle is associated in resolveMeshByHandle after this returns
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

  /**
   * Loads, parses, and creates a mesh from an STL file.
   * @param url The URL of the .stl file.
   * @returns A promise that resolves to the created or cached Mesh.
   */
  public async loadMeshFromSTL(url: string): Promise<Mesh> {
    const meshKey = `STL:${url}`;
    if (this.meshes.has(meshKey)) return this.meshes.get(meshKey)!;
    const stlGeometry = await loadSTL(url);
    const meshData: MeshData = {
      positions: stlGeometry.vertices,
      normals: stlGeometry.normals,
      indices: stlGeometry.indices,
    };
    const mesh = await this.createMesh(meshKey, meshData);
    _setHandle(mesh, meshKey);
    return mesh;
  }
}

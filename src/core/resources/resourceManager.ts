// src/core/resourceManager.ts
import { Renderer } from "@/core/rendering/renderer";
import {
  Mesh,
  PBRMaterialOptions,
  UnlitGroundMaterialOptions,
} from "@/core/types/gpu";
import { MeshData } from "@/core/types/mesh";

import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import { PBRMaterial } from "@/core/materials/pbrMaterial";
import { IBLComponent } from "@/core/ecs/components/iblComponent";
import { getSupportedCompressedFormats } from "@/core/utils/webgpu";
import { initBasis } from "@/core/wasm/basisModule";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { ResourceHandle } from "@/core/resources/resourceHandle";
import { MeshFactory } from "@/core/resources/meshFactory";
import { MaterialFactory } from "@/core/resources/materialFactory";
import { IblGenerator } from "@/core/rendering/iblGenerator";
import {
  MeshCache,
  SamplerCache,
  MaterialInstanceCache,
  PBRMaterialCache,
  MeshArrayCache,
} from "@/core/resources/resourceCache";
import { MeshLoaderRegistry } from "@/core/resources/mesh/meshLoaderRegistry";
import { PrimitiveMeshLoader } from "@/loaders/mesh/primitiveMeshLoader";
import { ObjMeshLoader } from "@/loaders/mesh/objMeshLoader";
import { StlMeshLoader } from "@/loaders/mesh/stlMeshLoader";
import { GltfMeshLoader } from "@/loaders/mesh/gltfMeshLoader";
import { GltfResourceManager } from "@/core/resources/gltf/gltfResourceManager";

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

  private meshCache: MeshCache = new MeshCache();
  private meshArrayCache: MeshArrayCache = new MeshArrayCache();
  private samplerCache: SamplerCache = new SamplerCache();
  private materialInstanceCache: MaterialInstanceCache =
    new MaterialInstanceCache();
  private pbrMaterialCache: PBRMaterialCache = new PBRMaterialCache();

  private meshLoaderRegistry = new MeshLoaderRegistry();
  private gltfManager: GltfResourceManager;

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
    this.registerMeshLoaders();
    this.gltfManager = new GltfResourceManager(this);
    initBasis("/basis_transcoder.wasm").catch((e) =>
      console.error("Failed to initialize Basis transcoder", e),
    ); // the wasm file is in the public dir, so root of the page
  }

  /**
   * Gets the GLTF resource manager for GLTF-specific operations.
   */
  public getGltfManager(): GltfResourceManager {
    return this.gltfManager;
  }

  /**
   * Gets the renderer instance.
   */
  public getRenderer(): Renderer {
    return this.renderer;
  }

  /**
   * Gets the default sampler.
   */
  public getDefaultSampler(): GPUSampler {
    return this.defaultSampler;
  }

  /**
   * Gets a sampler by handle.
   */
  public getSamplerByHandle(
    handle: ResourceHandle<GPUSampler>,
  ): GPUSampler | null {
    return this.samplerCache.get(handle);
  }

  /**
   * Caches a sampler.
   */
  public cacheSampler(
    handle: ResourceHandle<GPUSampler>,
    sampler: GPUSampler,
  ): void {
    this.samplerCache.set(handle, sampler);
  }

  /**
   * Registers all the built-in mesh loaders.
   */
  private registerMeshLoaders(): void {
    this.meshLoaderRegistry.register("PRIM", new PrimitiveMeshLoader());
    this.meshLoaderRegistry.register("OBJ", new ObjMeshLoader());
    this.meshLoaderRegistry.register("STL", new StlMeshLoader());
    this.meshLoaderRegistry.register("GLTF", new GltfMeshLoader());
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
   * Retrieves the resource handle associated with a given mesh object.
   *
   * @remarks
   * This allows for reverse lookups. If the mesh was part of a multi-mesh
   * asset loaded from a handle, this method will return the handle for the
   * entire asset (ie the GLTF file). The association is created when a
   * mesh is successfully resolved via `resolveMeshByHandle`.
   *
   * @param mesh - The mesh object whose handle is to be retrieved.
   * @returns The handle if the mesh is managed by the resource manager,
   *     otherwise undefined.
   */
  public getHandleForMesh(mesh: Mesh): ResourceHandle<Mesh> | null {
    // Try single mesh cache first
    let handle = this.meshCache.getHandle(mesh);
    if (handle) return handle;

    // Try mesh array cache
    handle = this.meshArrayCache.getHandle(mesh);
    return handle;
  }

  /**
   * Synchronously retrieves a pre-loaded mesh from the cache.
   *
   * @remarks
   * This method only returns a single mesh. If the handle resolves to an
   * array of meshes (ie a multi-primitive GLTF), this method will return null.
   * Use the asynchronous `resolveMeshByHandle` to get the full result.
   *
   * @param handle - The handle of the mesh to retrieve.
   * @returns The Mesh object if it has been loaded and cached as a single mesh, otherwise null.
   */
  public getMeshByHandleSync(handle: ResourceHandle<Mesh>): Mesh | null {
    // Try single mesh cache first
    const mesh = this.meshCache.get(handle);
    if (mesh) return mesh;

    // Try mesh array cache for single-primitive results
    const meshArray = this.meshArrayCache.get(handle);
    if (meshArray && meshArray.length === 1) {
      return meshArray[0];
    }

    return null;
  }

  /**
   * Synchronously retrieves a pre-loaded material instance from the cache.
   *
   * @param handle The handle of the material instance to retrieve.
   * @returns The MaterialInstance if cached, otherwise undefined.
   */
  public getMaterialInstanceByHandleSync(
    handle: ResourceHandle<MaterialInstance>,
  ): MaterialInstance | null {
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
  public getMaterialSpec(material: MaterialInstance): PBRMaterialSpec | null {
    return this.materialInstanceCache.getMetadata(
      material,
    ) as PBRMaterialSpec | null;
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

    const handle = ResourceHandle.forPbrTemplate(isTransparent);

    const cached = this.pbrMaterialCache.get(handle);
    if (cached) {
      return cached;
    }

    const materialTemplate = await MaterialFactory.createPBRTemplate(
      this.renderer.device,
      this.preprocessor,
      options,
    );

    this.pbrMaterialCache.set(handle, materialTemplate);
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
    const handle = ResourceHandle.forUnlitGroundMaterial(
      options.textureUrl,
      options.color,
    );

    const cached = this.materialInstanceCache.get(handle);
    if (cached) {
      return cached;
    }

    const instance = await MaterialFactory.createUnlitGroundMaterial(
      this.renderer.device,
      this.preprocessor,
      this.dummyTexture,
      this.defaultSampler,
      options,
    );

    this.materialInstanceCache.set(handle, instance);
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
    const finalKey = cacheKey ?? `PBR_INSTANCE:${Date.now()}_${Math.random()}`;
    const handle = ResourceHandle.forPbrMaterial(finalKey);

    const cached = this.materialInstanceCache.get(handle);
    if (cached) {
      return cached;
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

    // Store the spec as metadata
    this.materialInstanceCache.set(handle, instance, spec);

    return instance;
  }

  /**
   * Retrieves or creates a mesh or a collection of meshes from a resource handle.
   *
   * @remarks
   * This is the primary method for loading mesh assets. It uses the handle's key to cache results.
   * For multi-primitive meshes (like GLTF), this will return an array of meshes.
   * The entire result (single mesh or array) is cached to ensure consistency on subsequent calls.
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
   *
   * @param handle - The typed handle identifying the mesh asset.
   * @returns A promise that resolves to the requested Mesh object, an array of Mesh objects, or null.
   * @throws If the handle's key format is unsupported or the asset is not found.
   */
  public async resolveMeshByHandle(
    handle: ResourceHandle<Mesh>,
  ): Promise<Mesh | Mesh[] | null> {
    const key = handle.key;

    // Check single mesh cache first
    const singleCached = this.meshCache.get(handle);
    if (singleCached) {
      return singleCached;
    }

    // Check mesh array cache
    const arrayCached = this.meshArrayCache.get(handle);
    if (arrayCached) {
      return arrayCached;
    }

    const [type, ...rest] = key.split(":");
    const path = rest.join(":");

    const loader = this.meshLoaderRegistry.getLoader(type);
    if (!loader) {
      throw new Error(`Unsupported mesh handle type: ${type}`);
    }

    const loadResult = await loader.load(path);
    if (!loadResult) {
      console.error(
        `[ResourceManager] Failed to load mesh data for key: ${key}`,
      );
      return null;
    }

    // Cache based on result type
    if (Array.isArray(loadResult)) {
      const meshes = await Promise.all(
        loadResult.map((data, index) =>
          this.createMesh(`${key}-${index}`, data),
        ),
      );
      this.meshArrayCache.set(handle, meshes);
      return meshes;
    } else {
      const mesh = await this.createMesh(key, loadResult);
      this.meshCache.set(handle, mesh);
      return mesh;
    }
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
    const handle = ResourceHandle.forMesh(key);

    const cached = this.meshCache.get(handle);
    if (cached) {
      return cached;
    }

    const mesh: Mesh & { id?: number } = await MeshFactory.createMesh(
      this.renderer.device,
      key,
      data,
    );

    mesh.id = ResourceManager.nextMeshId++;

    this.meshCache.set(handle, mesh);

    return mesh;
  }
}

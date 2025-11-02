// src/core/resourceManager.ts
import { Renderer } from "@/core/rendering/renderer";
import {
  Mesh,
  PBRMaterialOptions,
  UnlitGroundMaterialOptions,
} from "@/core/types/gpu";

import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import { PBRMaterial } from "@/core/materials/pbrMaterial";
import { IBLComponent } from "@/core/ecs/components/iblComponent";
import { getSupportedCompressedFormats } from "@/core/utils/webgpu";
import { initBasis } from "@/core/wasm/basisModule";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { ResourceHandle } from "@/core/resources/resourceHandle";
import { MaterialFactory } from "@/core/resources/materialFactory";
import { IblGenerator } from "@/core/rendering/iblGenerator";
import {
  ResourceCache,
  MultiResourceCache,
} from "@/core/resources/resourceCache";
import { MeshLoaderRegistry } from "@/core/resources/mesh/meshLoaderRegistry";
import { PrimitiveMeshLoader } from "@/loaders/mesh/primitiveMeshLoader";
import { ObjMeshLoader } from "@/loaders/mesh/objMeshLoader";
import { StlMeshLoader } from "@/loaders/mesh/stlMeshLoader";
import { GltfMeshLoader } from "@/loaders/mesh/gltfMeshLoader";
import { GltfResourceManager } from "@/core/resources/gltf/gltfResourceManager";
import { ResourceType } from "@/core/resources/resourceHandle";
import { MeshFactory } from "@/core/resources/meshFactory";
import { MeshData } from "@/core/types/mesh";
import { UITexture } from "@/core/types/ui";
import { UITextureFactory } from "./uiTextureFactory";
import { UITextComponent } from "../ecs/components/ui/uiRenderComponent";
import { UIResourceManager } from "./ui/uiResourceManager";

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
 * Coordinates resource management across the engine.
 *
 * @remarks
 * This class acts as a central coordinator for resource operations. It manages
 * caches, delegates to specialized factories and loaders, and provides a unified
 * API for resource resolution. All actual resource creation is handled by
 * factories, making this manager purely a coordinator.
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

  // Caches for storing resolved resources
  private meshCache = new ResourceCache<Mesh>(ResourceType.Mesh);
  private meshArrayCache = new MultiResourceCache<Mesh>(ResourceType.Mesh);
  private samplerCache = new ResourceCache<GPUSampler>(ResourceType.Sampler);
  private materialInstanceCache = new ResourceCache<MaterialInstance>(
    ResourceType.Material,
  );
  private pbrMaterialCache = new ResourceCache<PBRMaterial>(
    ResourceType.MaterialTemplate,
  );
  private uiTextureCache = new ResourceCache<UITexture>(ResourceType.UITexture);

  // Delegates for actual resource creation
  private meshLoaderRegistry = new MeshLoaderRegistry();
  private gltfManager: GltfResourceManager;
  private uiResourceManager: UIResourceManager;

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

    // Initialize GLTF manager
    this.gltfManager = new GltfResourceManager(this);
    this.uiResourceManager = new UIResourceManager(this);

    initBasis("/basis_transcoder.wasm").catch((e) =>
      console.error("Failed to initialize Basis transcoder", e),
    );
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

  /**
   * Creates default resources used throughout the engine.
   */
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

  // === ACCESSORS FOR DELEGATES AND CONTEXT ===

  /**
   * Gets the GLTF resource manager for GLTF-specific operations.
   */
  public getGltfManager(): GltfResourceManager {
    return this.gltfManager;
  }

  /**
   * Gets the GLTF resource manager for GLTF-specific operations.
   */
  public getUiResourceManager(): UIResourceManager {
    return this.uiResourceManager;
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
   * Gets the dummy texture used as fallback.
   */
  public getDummyTexture(): GPUTexture {
    return this.dummyTexture;
  }

  /**
   * Gets the shader preprocessor.
   */
  public getShaderPreprocessor(): ShaderPreprocessor {
    return this.preprocessor;
  }

  /**
   * Gets supported compressed texture formats.
   */
  public getSupportedCompressedFormats(): Set<GPUTextureFormat> {
    return this.supportedCompressedFormats;
  }

  /**
   * Gets the next unique mesh ID.
   */
  public getNextMeshId(): number {
    return ResourceManager.nextMeshId++;
  }

  // === CACHE MANAGEMENT ===

  /**
   * Gets a mesh by handle from cache.
   */
  public getMeshByHandleSync(handle: ResourceHandle<Mesh>): Mesh | null {
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
   * Gets a material instance by handle from cache.
   */
  public getMaterialInstanceByHandleSync(
    handle: ResourceHandle<MaterialInstance>,
  ): MaterialInstance | null {
    return this.materialInstanceCache.get(handle);
  }

  /**
   * Gets a sampler by handle from cache.
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
   * Gets the handle for a mesh.
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
   * Gets material specification metadata.
   */
  public getMaterialSpec(material: MaterialInstance): PBRMaterialSpec | null {
    return this.materialInstanceCache.getMetadata(
      material,
    ) as PBRMaterialSpec | null;
  }

  // === RESOURCE RESOLUTION ===

  /**
   * Resolves a mesh handle by delegating to appropriate loader.
   *
   * @remarks
   * This method coordinates the loading process by selecting the appropriate
   * loader and caching the result. All actual mesh creation is delegated
   * to MeshFactory through the createMesh method.
   *
   * @param handle The mesh handle to resolve
   * @returns Promise resolving to mesh, array of meshes, or null
   */
  public async resolveMeshByHandle(
    handle: ResourceHandle<Mesh>,
  ): Promise<Mesh | Mesh[] | null> {
    const key = handle.key;

    // Check caches first
    const singleCached = this.meshCache.get(handle);
    if (singleCached) {
      return singleCached;
    }

    const arrayCached = this.meshArrayCache.get(handle);
    if (arrayCached) {
      return arrayCached;
    }

    // Delegate to loader registry
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

    // Use the unified createMesh method for single meshes
    if (Array.isArray(loadResult)) {
      const meshes = await Promise.all(
        loadResult.map((data, index) =>
          this.createMesh(`${key}-${index}`, data),
        ),
      );
      this.meshArrayCache.set(handle, meshes);
      return meshes;
    } else {
      // Use the unified createMesh method
      return this.createMesh(key, loadResult);
    }
  }

  /**
   * Creates a mesh from raw mesh data.
   *
   * @remarks
   * This is a low-level method for creating meshes directly from data.
   * Most code should use resolveMeshByHandle instead for proper caching.
   * This method handles caching and delegates to MeshFactory for actual creation.
   *
   * @param key A unique key to identify the mesh
   * @param data The raw mesh data
   * @returns Promise resolving to created mesh
   */
  public async createMesh(key: string, data: MeshData): Promise<Mesh> {
    const handle = ResourceHandle.forMesh(key);

    // Check cache first
    const cached = this.meshCache.get(handle);
    if (cached) {
      return cached;
    }

    // Delegate to MeshFactory and assign unique ID
    const mesh: Mesh & { id?: number } = await MeshFactory.createMesh(
      this.renderer.device,
      key,
      data,
    );
    mesh.id = this.getNextMeshId();

    // Cache the result
    this.meshCache.set(handle, mesh);
    return mesh;
  }

  /**
   * Creates or retrieves a cached PBR material template.
   *
   * @remarks
   * Material templates define the shader and pipeline for a class of materials
   * (like opaque vs. transparent), avoiding redundant shader compilation.
   * Templates are cached in the ResourceManager to ensure reuse across the engine.
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
   * This is useful when you already have a template and want to create multiple
   * instances from it (like in GLTF loading).
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
   * Resolves a material specification by delegating to MaterialFactory.
   *
   * @remarks
   * This method coordinates material creation by interpreting the specification
   * and delegating all actual creation to the MaterialFactory.
   *
   * @param spec The material specification
   * @param cacheKey Optional cache key
   * @returns Promise resolving to material instance
   */
  public async resolveMaterialSpec(
    spec: PBRMaterialSpec,
    cacheKey?: string,
  ): Promise<MaterialInstance> {
    const finalKey = cacheKey ?? `PBR_INSTANCE:${Date.now()}_${Math.random()}`;
    const handle = ResourceHandle.forMaterial(finalKey);

    const cached = this.materialInstanceCache.get(handle);
    if (cached) {
      return cached;
    }

    if (!spec || spec.type !== "PBR") {
      throw new Error("Unsupported material spec (expected type 'PBR').");
    }

    // Delegate all creation to MaterialFactory
    const instance = await MaterialFactory.resolvePBRMaterial(
      this.renderer.device,
      this.supportedCompressedFormats,
      this.dummyTexture,
      this.defaultSampler,
      this.preprocessor,
      spec.options,
    );

    // Cache with metadata
    this.materialInstanceCache.set(handle, instance, spec);

    return instance;
  }

  /**
   * Creates an environment map by delegating to IblGenerator.
   *
   * @remarks
   * This method coordinates IBL generation, delegating the actual work to
   * the IblGenerator.
   *
   * @param url The environment map URL
   * @param cubemapSize The cubemap resolution
   * @returns Promise resolving to environment map
   */
  public async createEnvironmentMap(
    url: string,
    cubemapSize = 512,
  ): Promise<EnvironmentMap> {
    // Lazily initialize the IBL generator
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
   * Creates an unlit ground material by delegating to MaterialFactory.
   *
   * @remarks
   * This method coordinates ground material creation, delegating to the
   * MaterialFactory for the actual implementation.
   *
   * @param options Ground material options
   * @returns Promise resolving to material instance
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

    // Delegate to MaterialFactory
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
   * Resolves a UI texture by key, loading from URL if not cached.
   */
  public async resolveUITexture(key: string, url: string): Promise<UITexture> {
    const handle = ResourceHandle.forUITexture(key);

    const cached = this.uiTextureCache.get(handle);
    if (cached) return cached;

    // Delegate to factory
    const texture = await UITextureFactory.createFromURL(
      this.renderer.device,
      url,
    );

    this.uiTextureCache.set(handle, texture);
    return texture;
  }

  /**
   * Resolves a text texture, generating if not cached.
   */
  public resolveTextTexture(textComponent: UITextComponent): UITexture {
    const cacheKey = UITextureFactory.generateTextCacheKey(textComponent);
    const handle = ResourceHandle.forUITexture(cacheKey);

    const cached = this.uiTextureCache.get(handle);
    if (cached) return cached;

    // Delegate to factory
    const texture = UITextureFactory.createFromText(
      this.renderer.device,
      textComponent,
    );

    this.uiTextureCache.set(handle, texture);
    return texture;
  }

  /**
   * Gets a UI texture by key from cache.
   */
  public getUITextureByKey(key: string): UITexture | null {
    const handle = ResourceHandle.forUITexture(key);
    return this.uiTextureCache.get(handle);
  }

  /**
   * Gets a UI texture by handle from cache.
   */
  public getUITextureByHandle(
    handle: ResourceHandle<UITexture>,
  ): UITexture | null {
    return this.uiTextureCache.get(handle);
  }
}

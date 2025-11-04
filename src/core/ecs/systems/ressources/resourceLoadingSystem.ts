// src/core/ecs/systems/ressources/resourceLoadingSystem.ts
import { World } from "@/core/ecs/world";
import {
  BaseResourceComponent,
  IBLResourceComponent,
  MaterialResourceComponent,
  MeshResourceComponent,
} from "@/core/ecs/components/resources/resourceComponents";
import {
  IBLData,
  ResourceCacheComponent,
} from "@/core/ecs/components/resources/resourceCacheComponent";
import { ResourceHandle, ResourceType } from "@/core/resources/resourceHandle";
import { Renderer } from "@/core/rendering/renderer";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import { getSupportedCompressedFormats } from "@/core/utils/webgpu";
import { initBasis } from "@/core/wasm/basisModule";
import { MeshLoaderRegistry } from "@/core/resources/mesh/meshLoaderRegistry";
import { PrimitiveMeshLoader } from "@/loaders/mesh/primitiveMeshLoader";
import { ObjMeshLoader } from "@/loaders/mesh/objMeshLoader";
import { StlMeshLoader } from "@/loaders/mesh/stlMeshLoader";
import { GltfMeshLoader } from "@/loaders/mesh/gltfMeshLoader";
import { MeshFactory } from "@/core/resources/meshFactory";
import { MaterialFactory } from "@/core/resources/materialFactory";
import { IblGenerator } from "@/core/rendering/iblGenerator";
import { PBRMaterialSpec } from "@/core/types/material";
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { createMaterialSpecKey } from "@/core/utils/material";
import { PBRMaterialSpecComponent } from "@/core/ecs/components/resources/materialSpecComponent";

/**
 * System that manages asynchronous loading of all resource types.
 *
 * @remarks
 * This system queries for entities with resource components (ie
 * `MeshResourceComponent`) that are in a loading state. It checks a global
 * `ResourceCacheComponent` to avoid re-loading assets. If an asset is not
 * cached, it delegates to the appropriate factory or loader, manages a
 * concurrent load queue, and populates the component and cache upon completion.
 */
export class ResourceLoadingSystem {
  private readonly MAX_CONCURRENT_LOADS = 8;

  private renderer: Renderer;
  private preprocessor: ShaderPreprocessor;
  private meshLoaderRegistry: MeshLoaderRegistry;
  private iblGenerator!: IblGenerator;
  private brdfLut: GPUTexture | null = null;
  private activeLoads = new Set<string>();
  private loadingPromises = new Map<string, Promise<unknown>>();

  /**
   * @param renderer - The main renderer instance.
   */
  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.preprocessor = new ShaderPreprocessor();
    this.meshLoaderRegistry = new MeshLoaderRegistry();
  }

  /**
   * Initializes the resource system and its dependencies.
   * @remarks
   * This must be called before the system can be used. It sets up mesh loaders,
   * initializes the Basis transcoder, and prepares the IBL generator.
   */
  public async init(): Promise<void> {
    this.meshLoaderRegistry.register("PRIM", new PrimitiveMeshLoader());
    this.meshLoaderRegistry.register("OBJ", new ObjMeshLoader());
    this.meshLoaderRegistry.register("STL", new StlMeshLoader());
    this.meshLoaderRegistry.register("GLTF", new GltfMeshLoader());

    this.iblGenerator = new IblGenerator(
      this.renderer.device,
      this.preprocessor,
    );
    await this.iblGenerator.initialize();

    await initBasis("/basis_transcoder.wasm").catch((e) =>
      console.error("Failed to initialize Basis transcoder", e),
    );
  }

  /**
   * Explicitly loads a resource by its handle and returns a promise.
   * @remarks
   * This is useful for setup code (e.g., in scenes) where you need to `await` a resource.
   * It works for resource types where the handle's key contains all necessary
   * loading information, such as meshes (`PRIM:`, `OBJ:`) and IBLs (URL key).
   * It is not suitable for materials, which depend on a separate spec component.
   * Use `loadMaterial` for that purpose.
   *
   * @param world - The ECS world, used to access the cache.
   * @param handle - The handle of the resource to load.
   * @returns A promise that resolves with the loaded resource.
   */
  public loadByHandle<T>(world: World, handle: ResourceHandle<T>): Promise<T> {
    const key = handle.key;
    const cache = world.getOrAddResource(ResourceCacheComponent);

    const cachedResource = this.getFromCache(handle.type, key, cache);
    if (cachedResource) {
      return Promise.resolve(cachedResource as T);
    }

    const existingPromise = this.loadingPromises.get(key);
    if (existingPromise) {
      return existingPromise as Promise<T>;
    }

    const promise = this._loadResourceByHandle(handle).then((resource) => {
      this.loadingPromises.delete(key);
      this.setInCache(handle.type, key, resource, cache);
      return resource as T;
    });

    this.loadingPromises.set(key, promise);
    return promise;
  }

  /**
   * Explicitly loads a material from its specification and returns a promise.
   * @param world - The ECS world, used to access the cache.
   * @param spec - The PBR material specification.
   * @returns A promise that resolves with the loaded MaterialInstance.
   */
  public loadMaterial(
    world: World,
    spec: PBRMaterialSpec,
  ): Promise<MaterialInstance> {
    const key = createMaterialSpecKey(spec);
    const cache = world.getOrAddResource(ResourceCacheComponent);

    const cachedMaterial = cache.getMaterial(key);
    if (cachedMaterial) {
      return Promise.resolve(cachedMaterial);
    }

    const existingPromise = this.loadingPromises.get(key);
    if (existingPromise) {
      return existingPromise as Promise<MaterialInstance>;
    }

    const promise = this._loadMaterial(spec).then((material) => {
      this.loadingPromises.delete(key);
      cache.setMaterial(key, material);
      return material;
    });

    this.loadingPromises.set(key, promise);
    return promise;
  }

  private _loadResourceByHandle(
    handle: ResourceHandle<unknown>,
  ): Promise<unknown> {
    switch (handle.type) {
      case ResourceType.Mesh:
        return this._loadMesh(handle as ResourceHandle<Mesh | Mesh[]>);
      case ResourceType.EnvironmentMap:
        return this._loadIBLFromHandle(handle);
      case ResourceType.Material:
        return Promise.reject(
          new Error(
            "Cannot load material by handle. Use loadMaterial(spec) or component-driven loading.",
          ),
        );
      default:
        return Promise.reject(
          new Error(
            `Unsupported resource type for handle-based loading: ${ResourceType[handle.type]}`,
          ),
        );
    }
  }

  /**
   * Processes the resource loading queue each frame for component-driven loading.
   * @param world - The ECS world.
   */
  public update(world: World): void {
    const cache = world.getOrAddResource(ResourceCacheComponent);

    this.processMeshes(world, cache);
    this.processMaterials(world, cache);
    this.processIBLs(world, cache);
  }

  private processMeshes(world: World, cache: ResourceCacheComponent): void {
    const query = world.query([MeshResourceComponent]);
    for (const entity of query) {
      if (this.activeLoads.size >= this.MAX_CONCURRENT_LOADS) break;
      const component = world.getComponent(entity, MeshResourceComponent);
      if (!component?.loading) continue;

      const key = component.handle.key;
      const cached = cache.getMesh(key);
      if (cached) {
        component.mesh = cached;
        component.loading = false;
        continue;
      }

      if (this.activeLoads.has(key)) continue;

      this.activeLoads.add(key);
      this._loadMesh(component.handle as ResourceHandle<Mesh | Mesh[]>)
        .then((mesh) => {
          cache.setMesh(key, mesh);
          component.mesh = mesh;
        })
        .catch((e) => (component.loadError = e.message))
        .finally(() => {
          component.loading = false;
          this.activeLoads.delete(key);
        });
    }
  }

  private processMaterials(world: World, cache: ResourceCacheComponent): void {
    const query = world.query([
      MaterialResourceComponent,
      PBRMaterialSpecComponent,
    ]);
    for (const entity of query) {
      if (this.activeLoads.size >= this.MAX_CONCURRENT_LOADS) break;
      const resComp = world.getComponent(entity, MaterialResourceComponent);
      const specComp = world.getComponent(entity, PBRMaterialSpecComponent);

      if (!resComp || !specComp || !resComp.loading) continue;

      const key = createMaterialSpecKey(specComp.spec);
      const cached = cache.getMaterial(key);
      if (cached) {
        resComp.material = cached;
        resComp.loading = false;
        continue;
      }

      if (this.activeLoads.has(key)) continue;

      this.activeLoads.add(key);
      this._loadMaterial(specComp.spec)
        .then((material) => {
          cache.setMaterial(key, material);
          resComp.material = material;
        })
        .catch((e) => (resComp.loadError = e.message))
        .finally(() => {
          resComp.loading = false;
          this.activeLoads.delete(key);
        });
    }
  }

  private processIBLs(world: World, cache: ResourceCacheComponent): void {
    const query = world.query([IBLResourceComponent]);
    for (const entity of query) {
      if (this.activeLoads.size >= this.MAX_CONCURRENT_LOADS) break;
      const component = world.getComponent(entity, IBLResourceComponent);
      if (!component?.loading) continue;

      const key = component.handle.key;
      const cached = cache.getIBL(key);
      if (cached) {
        component.iblComponent = cached.iblComponent;
        component.skyboxMaterial = cached.skyboxMaterial;
        component.loading = false;
        continue;
      }

      if (this.activeLoads.has(key)) continue;

      this.activeLoads.add(key);
      this._loadIBL(component)
        .then((iblData) => {
          cache.setIBL(key, iblData);
          component.iblComponent = iblData.iblComponent;
          component.skyboxMaterial = iblData.skyboxMaterial;
        })
        .catch((e) => (component.loadError = e.message))
        .finally(() => {
          component.loading = false;
          this.activeLoads.delete(key);
        });
    }
  }

  private getFromCache(
    type: ResourceType,
    key: string,
    cache: ResourceCacheComponent,
  ): unknown {
    switch (type) {
      case ResourceType.Mesh:
        return cache.getMesh(key);
      case ResourceType.Material:
        return cache.getMaterial(key);
      case ResourceType.EnvironmentMap:
        return cache.getIBL(key);
      default:
        return null;
    }
  }

  private setInCache(
    type: ResourceType,
    key: string,
    resource: unknown,
    cache: ResourceCacheComponent,
  ): void {
    switch (type) {
      case ResourceType.Mesh:
        cache.setMesh(key, resource as Mesh | Mesh[]);
        break;
      case ResourceType.Material:
        cache.setMaterial(key, resource as MaterialInstance);
        break;
      case ResourceType.EnvironmentMap:
        cache.setIBL(key, resource as IBLData);
        break;
    }
  }

  private applyToComponent(
    component: BaseResourceComponent,
    resource: unknown,
  ): void {
    component.loading = false;
    if (component instanceof MeshResourceComponent) {
      component.mesh = resource as Mesh | Mesh[];
    } else if (component instanceof MaterialResourceComponent) {
      component.material = resource as MaterialInstance;
    } else if (component instanceof IBLResourceComponent) {
      const iblData = resource as IBLData;
      component.iblComponent = iblData.iblComponent;
      component.skyboxMaterial = iblData.skyboxMaterial;
    }
  }

  private async _loadMesh(
    handle: ResourceHandle<Mesh | Mesh[]>,
  ): Promise<Mesh | Mesh[]> {
    const key = handle.key;
    const [type, ...rest] = key.split(":");
    const path = rest.join(":");

    const loader = this.meshLoaderRegistry.getLoader(type);
    if (!loader) throw new Error(`Unsupported mesh handle type: ${type}`);

    const loadResult = await loader.load(path);
    if (!loadResult)
      throw new Error(`Mesh loader returned null for key: ${key}`);

    if (Array.isArray(loadResult)) {
      return Promise.all(
        loadResult.map((data, index) =>
          MeshFactory.createMesh(this.renderer.device, `${key}#${index}`, data),
        ),
      );
    } else {
      return MeshFactory.createMesh(this.renderer.device, key, loadResult);
    }
  }

  private async _loadMaterial(
    spec: PBRMaterialSpec,
  ): Promise<MaterialInstance> {
    const supportedFormats = getSupportedCompressedFormats(
      this.renderer.device,
    );
    const dummyTexture = this.renderer.getDummyTexture();

    return MaterialFactory.resolvePBRMaterial(
      this.renderer.device,
      supportedFormats,
      dummyTexture,
      this.preprocessor,
      spec.options,
    );
  }

  private async _loadIBL(component: IBLResourceComponent): Promise<IBLData> {
    const result = await this.iblGenerator.generate({
      url: component.url,
      cubemapSize: component.cubemapSize,
      brdfLut: this.brdfLut,
    });
    this.brdfLut = result.brdfLut; // Cache for next time
    return {
      skyboxMaterial: result.skyboxMaterial,
      iblComponent: result.iblComponent,
    };
  }

  private async _loadIBLFromHandle(
    handle: ResourceHandle<unknown>,
  ): Promise<IBLData> {
    // We assume the handle key is the URL for IBLs
    const url = handle.key;
    const result = await this.iblGenerator.generate({
      url,
      cubemapSize: 512, // Default size for handle-based loading
      brdfLut: this.brdfLut,
    });
    this.brdfLut = result.brdfLut;
    return {
      skyboxMaterial: result.skyboxMaterial,
      iblComponent: result.iblComponent,
    };
  }
}

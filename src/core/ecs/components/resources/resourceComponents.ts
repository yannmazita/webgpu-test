// src/core/ecs/components/resources/resourceComponents.ts
import { IComponent } from "@/core/ecs/component";
import { ResourceHandle } from "@/core/resources/resourceHandle";
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { UITexture } from "@/core/types/ui";
import { IBLComponent } from "@/core/ecs/components/iblComponent";

/**
 * Base component for all managed resources.
 *
 * @remarks
 * This component provides common resource state including loading status,
 * error handling, and reference counting. All specific resource components
 * should extend this base class to ensure consistent resource management
 * across the engine.
 */
export abstract class BaseResourceComponent implements IComponent {
  /** The resource handle identifying this resource. */
  public handle: ResourceHandle<unknown>;

  /** Whether the resource is currently being loaded. */
  public loading = true;

  /** A message describing why the resource failed to load, if applicable. */
  public loadError: string | null = null;

  /** Reference count for automatic cleanup. */
  public refCount = 1;

  /** Optional metadata for storing additional state or flags. */
  public metadata?: unknown;

  /**
   * @param handle - The resource handle.
   */
  constructor(handle: ResourceHandle<unknown>) {
    this.handle = handle;
  }

  /**
   * Increments the reference count.
   * @remarks
   * Called when another entity starts using this resource.
   */
  public addRef(): void {
    this.refCount++;
  }

  /**
   * Decrements the reference count.
   * @remarks
   * Called when an entity stops using this resource.
   * When count reaches 0, the resource can be unloaded.
   * @returns True if reference count reached 0.
   */
  public release(): boolean {
    this.refCount = Math.max(0, this.refCount - 1);
    return this.refCount === 0;
  }
}

/**
 * Component for managing mesh resources.
 *
 * @remarks
 * This component holds a mesh resource that can be shared across multiple
 * entities. The mesh is loaded asynchronously and cached for reuse.
 * Use this component for any entity that needs to render 3D geometry.
 */
export class MeshResourceComponent extends BaseResourceComponent {
  /** The loaded mesh, or array of meshes for multi-primitive assets. Null until loading completes. */
  public mesh: Mesh | Mesh[] | null = null;

  /**
   * @param handle - The resource handle for the mesh.
   */
  constructor(handle: ResourceHandle<Mesh>) {
    super(handle);
  }
}

/**
 * Component for managing material instance resources.
 *
 * @remarks
 * This component holds a material instance that defines how surfaces are rendered.
 * It acts as a state tracker for a material loading request, which is defined
 * by a companion component like `PBRMaterialSpecComponent` on the same entity.
 */
export class MaterialResourceComponent implements IComponent {
  /** The loaded material instance, null until loading completes. */
  public material: MaterialInstance | null = null;
  /** Whether the resource is currently being loaded. */
  public loading = true;
  /** A message describing why the resource failed to load, if applicable. */
  public loadError: string | null = null;
}

/**
 * Component for managing UI texture resources.
 *
 * @remarks
 * This component holds UI textures used for rendering 2D interface elements.
 * UI textures are loaded asynchronously and cached for reuse.
 * Use this component for any entity that displays UI images or text.
 */
export class UITextureResourceComponent extends BaseResourceComponent {
  /** The loaded UI texture, null until loading completes. */
  public texture: UITexture | null = null;

  /**
   * @param handle - The resource handle for the UI texture.
   */
  constructor(handle: ResourceHandle<UITexture>) {
    super(handle);
  }
}

/**
 * Component for managing IBL (Image-Based Lighting) resources.
 *
 * @remarks
 * This component holds environment maps and lighting data for realistic
 * scene illumination. IBL resources are computationally expensive to generate
 * and are cached for reuse across scenes.
 */
export class IBLResourceComponent extends BaseResourceComponent {
  /** The URL of the environment map source. */
  public url: string;

  /** The desired cubemap resolution. */
  public cubemapSize: number;

  /** The generated skybox material. */
  public skyboxMaterial?: MaterialInstance;

  /** The generated IBL component with lighting data. */
  public iblComponent?: IBLComponent;

  /**
   * @param handle - The IBL resource handle.
   * @param url - The environment map URL.
   * @param cubemapSize - The cubemap resolution.
   */
  constructor(
    handle: ResourceHandle<unknown>,
    url: string,
    cubemapSize: number,
  ) {
    super(handle);
    this.url = url;
    this.cubemapSize = cubemapSize;
  }
}

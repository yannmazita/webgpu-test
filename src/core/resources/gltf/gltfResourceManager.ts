// src/core/resources/gltfResourceManager.ts
import { ResourceManager } from "@/core/resources/resourceManager";
import { World } from "@/core/ecs/world";
import { Entity } from "@/core/ecs/entity";
import { loadGLTF, ParsedGLTF } from "@/loaders/gltfLoader";
import { GltfSceneLoader } from "@/loaders/gltfSceneLoader";
import { ResourceHandle } from "@/core/resources/resourceHandle";
import { Mesh } from "@/core/types/gpu";

/**
 * Manages GLTF-specific resource operations.
 *
 * @remarks
 * This class encapsulates all GLTF-specific functionality including scene loading,
 * sampler management, and GLTF asset coordination. It delegates to the main
 * ResourceManager for actual resource creation and caching. This separation allows
 * for GLTF-specific optimizations and keeps the main ResourceManager focused on
 * general resource management concerns.
 */
export class GltfResourceManager {
  private resourceManager: ResourceManager;

  constructor(resourceManager: ResourceManager) {
    this.resourceManager = resourceManager;
  }

  /**
   * Retrieves or creates a cached GPUSampler from a glTF sampler definition.
   *
   * @remarks
   * This method ensures that samplers with identical properties are not
   * duplicated. It translates glTF numeric codes into WebGPU string enums
   * and uses a string-based key for efficient caching.
   *
   * @param gltf - The parsed glTF asset.
   * @param samplerIndex - The optional index of the sampler in the glTF file.
   * If undefined, the default sampler is returned.
   * @returns A GPUSampler matching the definition, or a default sampler.
   */
  public getGLTFSampler(gltf: ParsedGLTF, samplerIndex?: number): GPUSampler {
    if (samplerIndex === undefined) {
      return this.resourceManager.getDefaultSampler();
    }

    const gltfSampler = gltf.json.samplers?.[samplerIndex];
    if (!gltfSampler) {
      console.warn(
        `[GltfResourceManager] glTF sampler index ${samplerIndex} not found. Using default.`,
      );
      return this.resourceManager.getDefaultSampler();
    }

    const handle = ResourceHandle.forGltfSampler(
      gltfSampler.magFilter,
      gltfSampler.minFilter,
      gltfSampler.wrapS,
      gltfSampler.wrapT,
    );

    // Check cache
    const cached = this.resourceManager.getSamplerByHandle(handle);
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

    const device = this.resourceManager.getRenderer().device;
    const newSampler = device.createSampler({
      label: `GLTF_SAMPLER_${handle.key}`,
      addressModeU: getAddressMode(gltfSampler.wrapS),
      addressModeV: getAddressMode(gltfSampler.wrapT),
      magFilter: getFilterMode(gltfSampler.magFilter),
      minFilter: getFilterMode(gltfSampler.minFilter),
      mipmapFilter: getMipmapFilterMode(gltfSampler.minFilter),
    });

    this.resourceManager.cacheSampler(handle, newSampler);
    return newSampler;
  }

  /**
   * Loads a glTF file and instantiates its scene graph into the ECS world.
   *
   * @remarks
   * This method handles the complete glTF loading pipeline including parsing,
   * resource resolution, and ECS entity creation. It uses the `GltfSceneLoader`
   * for the actual instantiation logic while coordinating resource loading
   * through the `ResourceManager`.
   *
   * @param world The World instance where the scene entities will be created.
   * @param url The URL of the `.gltf` or `.glb` file to load.
   * @returns A promise that resolves to the root Entity of the new hierarchy.
   */
  public async loadSceneFromGLTF(world: World, url: string): Promise<Entity> {
    const { parsedGltf, baseUri } = await loadGLTF(url);
    const sceneLoader = new GltfSceneLoader(world, this.resourceManager);
    return sceneLoader.load(parsedGltf, baseUri);
  }

  /**
   * Creates a handle for a GLTF mesh.
   *
   * @remarks
   * This is a convenience method that creates a formatted handle for GTLF
   * mesh resources. The handle follows the format "GLTF:url#meshName".
   *
   * @param url The GLTF file URL.
   * @param meshName The mesh name within the GLTF.
   * @returns A ResourceHandle for the GLTF mesh.
   */
  public createGltfMeshHandle(
    url: string,
    meshName: string,
  ): ResourceHandle<Mesh> {
    return ResourceHandle.forGltfMesh(url, meshName);
  }
}

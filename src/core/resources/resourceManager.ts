// src/core/resourceManager.ts
import { Renderer } from "@/core/rendering/renderer";
import { Material } from "@/core/materials/material";
import {
  AABB,
  Mesh,
  PBRMaterialOptions,
  UnlitGroundMaterialOptions,
} from "@/core/types/gpu";
import { MeshData } from "@/core/types/mesh";
import { createTextureFromImage } from "@/core/utils/texture";
import { createGPUBuffer } from "@/core/utils/webgpu";
import { loadOBJ } from "@/loaders/objLoader";
import { loadSTL } from "@/loaders/stlLoader";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import { mat4, quat, vec3 } from "wgpu-matrix";
import { PBRMaterial } from "@/core/materials/pbrMaterial";
import {
  createCubeMeshData,
  createIcosphereMeshData,
} from "@/core/utils/primitives";
import { UnlitGroundMaterial } from "@/core/materials/unlitGroundMaterial";
import { loadHDR } from "@/loaders/hdrLoader";
import { loadEXR } from "@/loaders/exrLoader";
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
  GLTFMaterial,
  GLTFPrimitive,
  loadGLTF,
  ParsedGLTF,
} from "@/loaders/gltfLoader";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { Entity } from "@/core/ecs/entity";
import { World } from "@/core/ecs/world";
import { setParent } from "@/core/ecs/utils/hierarchy";
import { MeshRendererComponent } from "@/core/ecs/components/meshRendererComponent";
import {
  AnimationClip,
  AnimationChannel,
  AnimationSampler,
} from "@/core/types/animation";
import { AnimationComponent } from "@/core/ecs/components/animationComponent";
import { MaterialInstance } from "@/core/materials/materialInstance";

const DEBUG_MESH_VALIDATION = true;

// MikkTSpace WASM loader and wrapper
type MikkTSpace = typeof import("mikktspace");
let mikktspace: MikkTSpace | null = null;
let mikktspacePromise: Promise<void> | null = null;

async function initMikkTSpace(): Promise<void> {
  if (mikktspace || mikktspacePromise) return mikktspacePromise;

  mikktspacePromise = new Promise((resolve) => {
    import("mikktspace")
      .then((module) => {
        const init = module.default ?? module.init;
        if (typeof init === "function") {
          init()
            .then(() => {
              mikktspace = module;
              console.log("MikkTSpace initialized successfully.");
              resolve();
            })
            .catch((e: Error) => {
              console.error("Failed to initialize MikkTSpace:", e);
              resolve();
            });
        } else if (module.generateTangents) {
          mikktspace = module;
          console.log("MikkTSpace initialized successfully.");
          resolve();
        } else {
          console.warn("MikkTSpace module format not recognized.");
          mikktspace = module;
          resolve();
        }
      })
      .catch((e: Error) => {
        console.error("Failed to initialize MikkTSpace:", e);
        resolve();
      });
  });
  return mikktspacePromise;
}

// This is a self-contained, minimized version of the half-float conversion
// logic from the EXR parser.
const _hf_utils = (() => {
  const buffer = new ArrayBuffer(4);
  const floatView = new Float32Array(buffer);
  const uint32View = new Uint32Array(buffer);
  const baseTable = new Uint32Array(512);
  const shiftTable = new Uint32Array(512);

  for (let i = 0; i < 256; ++i) {
    const e = i - 127;
    if (e < -27) {
      baseTable[i] = 0x0000;
      baseTable[i | 0x100] = 0x8000;
      shiftTable[i] = 24;
      shiftTable[i | 0x100] = 24;
    } else if (e < -14) {
      baseTable[i] = 0x0400 >> (-e - 14);
      baseTable[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000;
      shiftTable[i] = -e - 1;
      shiftTable[i | 0x100] = -e - 1;
    } else if (e <= 15) {
      baseTable[i] = (e + 15) << 10;
      baseTable[i | 0x100] = ((e + 15) << 10) | 0x8000;
      shiftTable[i] = 13;
      shiftTable[i | 0x100] = 13;
    } else if (e < 128) {
      baseTable[i] = 0x7c00;
      baseTable[i | 0x100] = 0xfc00;
      shiftTable[i] = 24;
      shiftTable[i | 0x100] = 24;
    } else {
      baseTable[i] = 0x7c00;
      baseTable[i | 0x100] = 0xfc00;
      shiftTable[i] = 13;
      shiftTable[i | 0x100] = 13;
    }
  }

  return {
    toHalf: (val: number): number => {
      // Clamp value to representable range
      const clamped = Math.max(-65504, Math.min(val, 65504));
      floatView[0] = clamped;
      const f = uint32View[0];
      const e = (f >> 23) & 0x1ff;
      return baseTable[e] + ((f & 0x007fffff) >> shiftTable[e]);
    },
  };
})();

function convertFloat32ToFloat16(data: Float32Array): Uint16Array {
  const halfs = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    halfs[i] = _hf_utils.toHalf(data[i]);
  }
  return halfs;
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
 * The context object passed through the glTF node instantiation process.
 * It holds shared data, caches, and mappings to avoid redundant work during
 * the recursive creation of the scene graph.
 */
interface NodeInstantiationContext {
  /**
   * The fully parsed glTF asset, including the JSON scene graph and all
   * associated binary buffer data. This is the primary source of data for the
   * instantiation process.
   */
  gltf: ParsedGLTF;

  /**
   * The base URI of the loaded glTF file. This is used to resolve any
   * relative paths for external assets like image textures.
   */
  baseUri: string;

  /**
   * An array of pre-created `PBRMaterial` templates, indexed to match the
   * `materials` array in the glTF JSON. This serves as a cache to avoid
   * redundant shader and pipeline layout creation.
   */
  materialTemplates: PBRMaterial[];

  /**
   * A set containing the indices of materials that are targeted by one or more
   * animations. This is used to determine whether a unique `MaterialInstance`
   * must be created (for animated materials) or if a shared, static instance
   * can be reused from the cache.
   */
  animatedMaterialIndices: Set<number>;

  /**
   * A map that links a glTF node index to its corresponding created `Entity`.
   * This is essential for setting up the scene hierarchy (linking children to
   * parents) and for targeting entities during animation playback.
   */
  nodeToEntityMap: Map<number, Entity>;

  /**
   * A map that links a glTF material index to an array of all entities that
   * use that material. This is primarily used to resolve material property
   * animations, allowing an animation to affect all objects that share the
   * targeted material.
   */
  materialToEntitiesMap: Map<number, Entity[]>;

  /**
   * A cache for `MaterialInstance` objects that are not targeted by
   * animations. This prevents the creation of redundant GPU resources (like
   * bind groups) for static materials that are shared across multiple meshes.
   * The key is a composite of the material index and sampler configuration to
   * ensure uniqueness.
   */
  staticMaterialInstanceCache: Map<string, MaterialInstance>;
}

/**
 * Computes the axis-aligned bounding box from vertex positions.
 * @param positions Flattened array of vertex positions [x,y,z,x,y,z,...]
 * @returns AABB with min and max corners
 */
function computeAABB(positions: Float32Array): AABB {
  if (positions.length === 0) {
    return { min: vec3.create(0, 0, 0), max: vec3.create(0, 0, 0) };
  }
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
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

// Internal helpers for attaching stable metadata
function _defineHidden<T extends object>(
  obj: T,
  key: string,
  value: unknown,
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
function _getHandle(obj: { __handle?: string }): string | undefined {
  return obj?.__handle;
}
function _getPbrOptions(obj: {
  __pbrOptions?: PBRMaterialOptions;
}): PBRMaterialOptions | undefined {
  return obj?.__pbrOptions;
}

/**
 * Manages the creation, loading, and caching of GPU resources.
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
  private pbrMaterialInitialized = false;
  private unlitGroundMaterialInitialized = false;
  private skyboxMaterialInitialized = false;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.preprocessor = new ShaderPreprocessor();
    this.createDefaultResources();
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
  private getGLTFSampler(gltf: ParsedGLTF, samplerIndex?: number): GPUSampler {
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

  public getHandleForMesh(mesh: Mesh): string | undefined {
    return _getHandle(mesh);
  }
  public getHandleForMaterial(material: Material): string | undefined {
    return _getHandle(material);
  }
  public getMaterialSpec(
    material: MaterialInstance,
  ): PBRMaterialSpec | undefined {
    const opts = _getPbrOptions(material);
    return opts ? { type: "PBR", options: opts } : undefined;
  }

  /**
   * Creates or retrieves a cached PBR material template.
   *
   * This method provides a shared `PBRMaterial` object that acts as a template
   * for creating material instances. Templates are cached based on their
   * transparency state to avoid redundant shader compilation and pipeline
   * layout creation, which are expensive operations. The transparency is
   * determined from the alpha channel of the `albedo` color in the options.
   *
   * Before creating the first template, this method ensures the static PBR
   * shader and its resources are initialized by calling `PBRMaterial.initialize()`.
   *
   * @param options An object containing material properties. Only the `albedo`
   *     property's alpha channel is used to determine if a transparent or
   *     opaque template is required. Defaults to an opaque template if no
   *     options are provided.
   * @returns A promise that resolves to a cached or newly created `PBRMaterial`
   *     template.
   */
  public async createPBRMaterialTemplate(
    options: PBRMaterialOptions = {},
  ): Promise<PBRMaterial> {
    const albedo = options.albedo ?? [1, 1, 1, 1];
    const isTransparent = albedo[3] < 1.0;
    const templateKey = `PBR_TEMPLATE:${isTransparent}`;
    const cached = this.materials.get(templateKey);
    if (cached) return cached as PBRMaterial;

    if (!this.pbrMaterialInitialized) {
      await PBRMaterial.initialize(this.renderer.device, this.preprocessor);
      this.pbrMaterialInitialized = true;
    }

    const materialTemplate = PBRMaterial.createTemplate(
      this.renderer.device,
      isTransparent,
    );
    this.materials.set(templateKey, materialTemplate);
    return materialTemplate;
  }

  /**
   * Creates a unique PBR material instance from a template and a set of
   * options.
   *
   * This method takes a shared PBRMaterial template and a specific set of
   * PBRMaterialOptions to create a fully configured MaterialInstance. It
   * handles the asynchronous loading and creation of all required GPU textures
   * based on the URLs provided in the options. If a texture URL is not
   * provided for a given map, a default 1x1 dummy texture is used as a
   * fallback.
   *
   * @param materialTemplate The shared PBRMaterial template that
   *     defines the shader and pipeline layout for this instance.
   * @param options An object containing material properties
   *     (like albedo color, metallic factor) and URLs for the
   *     various texture maps.
   * @param sampler Optional; GPUSampler to use for the
   *     material's textures. If not provided, the resource manager's default
   *     sampler will be used.
   * @returns A promise that resolves to a new MaterialInstance,
   *     complete with its own uniform buffer and bind group.
   */
  public async createPBRMaterialInstance(
    materialTemplate: PBRMaterial,
    options: PBRMaterialOptions = {},
    sampler?: GPUSampler,
  ): Promise<MaterialInstance> {
    // If no specific sampler is provided, fall back to the default.
    const finalSampler = sampler ?? this.defaultSampler;

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
    const specularFactorTexture = options.specularFactorMap
      ? await createTextureFromImage(
          this.renderer.device,
          options.specularFactorMap,
          "rgba8unorm",
        )
      : this.dummyTexture;
    const specularColorTexture = options.specularColorMap
      ? await createTextureFromImage(
          this.renderer.device,
          options.specularColorMap,
          "rgba8unorm-srgb",
        )
      : this.dummyTexture;
    return materialTemplate.createInstance(
      options,
      albedoTexture,
      metallicRoughnessTexture,
      normalTexture,
      emissiveTexture,
      occlusionTexture,
      specularFactorTexture,
      specularColorTexture,
      finalSampler,
    );
  }

  public async createUnlitGroundMaterial(
    options: UnlitGroundMaterialOptions,
  ): Promise<MaterialInstance> {
    const colorKey = options.color ? options.color.join(",") : "";
    const instanceKey = `UNLIT_GROUND_INSTANCE:${options.textureUrl ?? ""}:${colorKey}`;

    // For unlit materials with static properties, we can still cache the instance
    // because it will never be updated at runtime.
    const cached = this.materials.get(instanceKey);
    if (cached && cached instanceof MaterialInstance) {
      return cached;
    }

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

    const template = UnlitGroundMaterial.getTemplate(this.renderer.device);
    const instance = template.createInstance(
      options,
      texture,
      this.defaultSampler,
    );

    this.materials.set(instanceKey, instance as unknown as Material); // Cache the instance
    return instance;
  }

  public async createEnvironmentMap(
    url: string,
    cubemapSize = 512,
  ): Promise<EnvironmentMap> {
    console.log(
      `[ResourceManager] Creating environment map from ${url}, size=${cubemapSize}`,
    );

    if (!this.skyboxMaterialInitialized) {
      await SkyboxMaterial.initialize(this.renderer.device, this.preprocessor);
      this.skyboxMaterialInitialized = true;
    }

    // --- 1. Load and prepare equirectangular source texture ---
    let imageData: { width: number; height: number; data: Uint16Array };

    if (url.endsWith(".hdr")) {
      const hdrData = await loadHDR(url);
      console.log(
        `[ResourceManager] HDR loaded: ${hdrData.width}x${hdrData.height}`,
      );
      // Convert RGB float32 to RGBA float32
      const rgba32 = new Float32Array(hdrData.width * hdrData.height * 4);
      for (let i = 0; i < hdrData.width * hdrData.height; i++) {
        rgba32[i * 4 + 0] = hdrData.data[i * 3 + 0];
        rgba32[i * 4 + 1] = hdrData.data[i * 3 + 1];
        rgba32[i * 4 + 2] = hdrData.data[i * 3 + 2];
        rgba32[i * 4 + 3] = 1.0;
      }
      // Convert RGBA float32 to RGBA half-float (uint16)
      const rgba16 = convertFloat32ToFloat16(rgba32);
      imageData = {
        width: hdrData.width,
        height: hdrData.height,
        data: rgba16,
      };
    } else if (url.endsWith(".exr")) {
      const exrData = await loadEXR(url);
      console.log(
        `[ResourceManager] EXR loaded: ${exrData.width}x${exrData.height}`,
      );
      // EXR loader already provides Uint16Array (half-float) data
      imageData = {
        width: exrData.width,
        height: exrData.height,
        data: exrData.data,
      };
    } else {
      throw new Error(
        `Unsupported environment map format: ${url}. Please use .hdr or .exr`,
      );
    }

    const equirectTexture = this.renderer.device.createTexture({
      label: `EQUIRECTANGULAR_SRC:${url}`,
      size: [imageData.width, imageData.height],
      format: "rgba16float", // Use half-float format
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT, // RENDER_ATTACHMENT for potential mipmap generation
    });

    // Ensure bytesPerRow meets WebGPU 256-byte alignment
    const rowBytes = imageData.width * 4 /*channels*/ * 2; /*bytes/chan (half)*/
    const isAligned = (rowBytes & 0xff) === 0; // rowBytes % 256 === 0

    if (isAligned) {
      // Fast path: upload directly
      this.renderer.device.queue.writeTexture(
        { texture: equirectTexture },
        imageData.data.buffer,
        { bytesPerRow: rowBytes },
        { width: imageData.width, height: imageData.height },
      );
    } else {
      // Padded upload: copy rows into a buffer with 256-byte stride
      const alignedRowBytes = (rowBytes + 255) & ~255; // round up to 256
      const padded = new ArrayBuffer(alignedRowBytes * imageData.height);
      const paddedView = new Uint8Array(padded);
      const srcView = new Uint8Array(imageData.data.buffer);

      for (let y = 0; y < imageData.height; y++) {
        const srcOff = y * rowBytes;
        const dstOff = y * alignedRowBytes;
        // copy rowBytes bytes for this row
        paddedView.set(srcView.subarray(srcOff, srcOff + rowBytes), dstOff);
      }

      this.renderer.device.queue.writeTexture(
        { texture: equirectTexture },
        padded,
        { bytesPerRow: alignedRowBytes },
        { width: imageData.width, height: imageData.height },
      );
    }

    // --- 2. Convert to base environment cubemap ---
    console.log(`[ResourceManager] Converting equirect to cubemap...`);
    const environmentMap = await equirectangularToCubemap(
      this.renderer.device,
      this.preprocessor,
      equirectTexture,
      cubemapSize,
    );
    equirectTexture.destroy();

    // --- 3. Create Skybox Material Instance ---
    const skyboxSampler = this.renderer.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
    });
    const skyboxTemplate = SkyboxMaterial.createTemplate(this.renderer.device);
    const skyboxMaterialInstance = skyboxTemplate.createInstance(
      environmentMap,
      skyboxSampler,
    );
    _setHandle(skyboxMaterialInstance, `SKYBOX:${url}:${cubemapSize}`);

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
      cubemapSize,
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

    return { skyboxMaterial: skyboxMaterialInstance, iblComponent };
  }

  /**
   * Resolves a material specification to a material instance.
   */
  public async resolveMaterialSpec(
    spec: PBRMaterialSpec,
  ): Promise<MaterialInstance> {
    if (!spec || spec.type !== "PBR") {
      throw new Error("Unsupported material spec (expected type 'PBR').");
    }
    // This creates a new, unique instance from the spec.
    const template = await this.createPBRMaterialTemplate(spec.options);
    return this.createPBRMaterialInstance(
      template,
      spec.options,
      this.defaultSampler,
    );
  }

  // ---------- Mesh resolution by handle ----------

  /**
   * Loads a single mesh resource from a string identifier, known as a "handle".
   *
   * This method acts as a unified asset loader for mesh data. It parses the
   * handle to determine the asset type (ie procedural primitive, model
   * file) and its parameters. The handle also serves as a cache key, ensuring
   * that the same mesh resource is not processed or uploaded to the GPU
   * multiple times.
   *
   * Unlike `loadSceneFromGLTF`, this function only extracts the raw mesh
   * geometry and does not process materials, transforms, or scene graph
   * information.
   *
   * Supported handle formats:
   * - **Primitives:**
   *   - `"PRIM:cube"` (default size 1.0)
   *   - `"PRIM:cube:size=2.5"`
   *   - `"PRIM:icosphere"` (default radius 0.5, subdivisions 2)
   *   - `"PRIM:icosphere:r=1.0,sub=3"`
   * - **Model Files:**
   *   - `"OBJ:path/to/model.obj"`
   *   - `"STL:path/to/model.stl"`
   *   - `"GLTF:path/to/model.gltf#meshName"` (loads the first primitive of the
   *     named mesh)
   *
   * @param handle The string identifier for the mesh resource.
   * @return A promise that resolves to the requested `Mesh` object, which
   *     contains the GPU buffers and layout information.
   * @throws If the handle format is unsupported or the specified asset cannot
   *     be found.
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
      const gltfMesh = parsedGltf.json.meshes?.find((m) => m.name === meshName);
      if (!gltfMesh || gltfMesh.primitives.length === 0) {
        throw new Error(
          `Mesh "${meshName}" not found or has no primitives in ${url}`,
        );
      }

      // Using the first primitive for this simple asset-loading function.
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
   * Loads a glTF file and instantiates its scene graph into the ECS world.
   *
   * This function orchestrates the full loading process for a glTF scene, which
   * can range from a single object to a complex hierarchy. It performs the
   * following steps:
   * 1.  Parses the `.gltf` or `.glb` file.
   * 2.  Creates an entity for each node in the glTF scene graph, establishing
   *     the correct parent-child relationships.
   * 3.  Applies the transform (translation, rotation, scale) from each node to
   *     its corresponding entity's `TransformComponent`.
   * 4.  For each mesh primitive, it resolves the `Mesh` resource and its
   *     `MaterialInstance`, creating them if they don't already exist.
   * 5.  Adds a `MeshRendererComponent` to entities that have a mesh.
   * 6.  Parses animations and attaches an `AnimationComponent` to the root
   *     entity of the scene.
   *
   * This method is the primary entry point for adding pre-authored 3D assets
   * into the game world.
   *
   * @param world The `World` instance where the scene entities will be created.
   * @param url The URL of the `.gltf` or `.glb` file to load.
   * @return A promise that resolves to the root `Entity` of the newly created
   *     scene hierarchy.
   * @throws If the glTF file cannot be fetched, parsed, or if it references
   *     assets that cannot be found.
   */
  public async loadSceneFromGLTF(world: World, url: string): Promise<Entity> {
    const { parsedGltf: gltf, baseUri } = await loadGLTF(url);

    // --- Step 1: Pre-analysis and Asset Creation ---
    const materialTemplates: PBRMaterial[] = [];
    if (gltf.json.materials) {
      for (const mat of gltf.json.materials) {
        const pbr = mat.pbrMetallicRoughness ?? {};
        const options: PBRMaterialOptions = { albedo: pbr.baseColorFactor };
        const template = await this.createPBRMaterialTemplate(options);
        materialTemplates.push(template);
      }
    }

    const animatedMaterialIndices = new Set<number>();
    if (gltf.json.animations) {
      for (const anim of gltf.json.animations) {
        for (const channel of anim.channels) {
          const pointer =
            channel.target.extensions?.KHR_animation_pointer?.pointer;
          if (pointer) {
            const parts = pointer.split("/");
            if (parts[1] === "materials") {
              animatedMaterialIndices.add(parseInt(parts[2], 10));
            }
          }
        }
      }
    }

    // --- Step 2: Scene Instantiation ---
    const sceneIndex = gltf.json.scene ?? 0;
    const scene = gltf.json.scenes?.[sceneIndex];
    if (!scene) {
      throw new Error(`Scene not found in glTF file.`);
    }
    const sceneRootEntity = world.createEntity();
    world.addComponent(sceneRootEntity, new TransformComponent());

    const nodeToEntityMap = new Map<number, Entity>();
    const materialToEntitiesMap = new Map<number, Entity[]>();
    const staticMaterialInstanceCache = new Map<string, MaterialInstance>();

    const context: NodeInstantiationContext = {
      gltf,
      baseUri,
      materialTemplates,
      animatedMaterialIndices,
      nodeToEntityMap,
      materialToEntitiesMap,
      staticMaterialInstanceCache,
    };

    for (const nodeIndex of scene.nodes) {
      await this.instantiateNode(
        world,
        gltf,
        nodeIndex,
        sceneRootEntity,
        context,
      );
    }

    // --- Step 3: Animation Parsing and Channel Creation ---
    const clips: AnimationClip[] = [];
    if (gltf.json.animations) {
      for (const anim of gltf.json.animations) {
        const channels: AnimationChannel[] = [];
        let duration = 0;

        const samplerCache: (AnimationSampler & { path?: string })[] =
          anim.samplers.map((s) => {
            const times = getAccessorData(gltf, s.input) as Float32Array;
            const values = getAccessorData(gltf, s.output) as Float32Array;
            const interpolation = (s.interpolation ?? "LINEAR") as
              | "LINEAR"
              | "STEP"
              | "CUBICSPLINE";
            const outAccessor = gltf.json.accessors![s.output];
            const stride =
              outAccessor.type === "VEC3"
                ? 3
                : outAccessor.type === "VEC4"
                  ? 4
                  : 3;
            if (times.length > 0) {
              duration = Math.max(duration, times[times.length - 1]);
            }
            return { times, values, interpolation, valueStride: stride };
          });

        for (const ch of anim.channels) {
          const sampler = samplerCache[ch.sampler];
          const pointer = ch.target.extensions?.KHR_animation_pointer?.pointer;

          if (pointer) {
            const parts = pointer.split("/");
            if (parts[1] === "materials" && parts.length >= 4) {
              const matIndex = parseInt(parts[2], 10);
              const property = parts.slice(3).join("/");
              const targetEntities = materialToEntitiesMap.get(matIndex);
              if (targetEntities) {
                for (const targetEntity of targetEntities) {
                  channels.push({
                    targetEntity,
                    path: { component: MeshRendererComponent, property },
                    sampler,
                  });
                }
              }
            }
          } else if (ch.target.node !== undefined) {
            const targetEntity = nodeToEntityMap.get(ch.target.node);
            if (
              targetEntity &&
              (ch.target.path === "translation" ||
                ch.target.path === "rotation" ||
                ch.target.path === "scale")
            ) {
              sampler.path = ch.target.path;
              channels.push({
                targetEntity,
                path: {
                  component: TransformComponent,
                  property: ch.target.path,
                },
                sampler,
              });
            }
          }
        }
        const clipName = anim.name ?? `GLTF_Animation_${clips.length}`;
        clips.push({ name: clipName, duration, channels });
      }
    }

    if (clips.length > 0) {
      world.addComponent(sceneRootEntity, new AnimationComponent(clips));
      console.log(
        `[ResourceManager] Loaded ${clips.length} animation clip(s) from GLTF`,
        clips.map((c) => ({
          name: c.name,
          duration: c.duration.toFixed(3),
          channels: c.channels.length,
        })),
      );
    }
    return sceneRootEntity;
  }

  /**
   * Builds PBR material options from a glTF material, resolving factors,
   * textures, UV set indices, and optional extensions.
   *
   * Behavior:
   * - Reads core PBR Metallic-Roughness properties (baseColorFactor, metallicFactor,
   *   roughnessFactor) and associated textures.
   * - Reads normal/emissive/occlusion textures and their auxiliary parameters
   *   (normalTexture.scale, occlusionTexture.strength), plus per-texture UV set indices.
   * - Resolves image URIs for textures including bufferView-embedded images, using
   *   the response URL from the glTF fetch as baseUri for relative paths.
   * - Supports KHR_materials_emissive_strength: stores its scalar into
   *   options.emissiveStrength (default 1.0). If KHR_materials_unlit is present,
   *   emissiveStrength is ignored (reset to 1.0) per the spec exclusion.
   * - Supports KHR_materials_specular: reads specular factor/color and associated textures.
   * - Implements a heuristic for packed ARM/ORM textures: if a metallic-roughness
   *   texture is present but an occlusion texture is not, it assumes occlusion is
   *   packed into the R channel of the metallic-roughness map.
   *
   * @param gltfMat The parsed glTF material object.
   * @param gltf The parsed glTF asset (JSON + buffers), used to resolve image URIs.
   * @param baseUri The base URI used to resolve relative texture/image paths.
   * @returns A PBRMaterialOptions object suitable for creating material instances.
   */
  private _getGLTFMaterialOptions(
    gltfMat: GLTFMaterial,
    gltf: ParsedGLTF,
    baseUri: string,
  ): PBRMaterialOptions {
    const pbr = gltfMat.pbrMetallicRoughness ?? {};
    const matExt = gltfMat.extensions;

    const options: PBRMaterialOptions = {
      // Core factors
      albedo: pbr.baseColorFactor,
      metallic: pbr.metallicFactor,
      roughness: pbr.roughnessFactor,

      // Additional factors
      emissive: gltfMat.emissiveFactor,
      normalIntensity: gltfMat.normalTexture?.scale,
      occlusionStrength: gltfMat.occlusionTexture?.strength,

      // Per-texture UV set indices (default 0)
      albedoUV: pbr.baseColorTexture?.texCoord ?? 0,
      metallicRoughnessUV: pbr.metallicRoughnessTexture?.texCoord ?? 0,
      normalUV: gltfMat.normalTexture?.texCoord ?? 0,
      emissiveUV: gltfMat.emissiveTexture?.texCoord ?? 0,
      occlusionUV: gltfMat.occlusionTexture?.texCoord ?? 0,

      // KHR_materials_emissive_strength (default handled below)
      emissiveStrength: 1.0,
    };

    // Resolve texture URIs (base color)
    if (pbr.baseColorTexture) {
      options.albedoMap = this.getImageUri(
        gltf,
        pbr.baseColorTexture.index,
        baseUri,
      );
    }

    // Metallic-Roughness texture (glTF convention: G = roughness, B = metallic)
    if (pbr.metallicRoughnessTexture) {
      options.metallicRoughnessMap = this.getImageUri(
        gltf,
        pbr.metallicRoughnessTexture.index,
        baseUri,
      );
    }

    // Normal map
    if (gltfMat.normalTexture) {
      options.normalMap = this.getImageUri(
        gltf,
        gltfMat.normalTexture.index,
        baseUri,
      );
    }

    // Emissive map
    if (gltfMat.emissiveTexture) {
      options.emissiveMap = this.getImageUri(
        gltf,
        gltfMat.emissiveTexture.index,
        baseUri,
      );
    }

    // Occlusion map
    if (gltfMat.occlusionTexture) {
      options.occlusionMap = this.getImageUri(
        gltf,
        gltfMat.occlusionTexture.index,
        baseUri,
      );
    }

    // Heuristic for packed Ambient Occlusion (in Metallic-Roughness texture)
    // If MR map exists but a separate AO map does not, assume AO is in R channel of MR map.
    if (options.metallicRoughnessMap && !options.occlusionMap) {
      options.usePackedOcclusion = true;
    }

    // KHR_materials_emissive_strength
    const strength = matExt?.KHR_materials_emissive_strength?.emissiveStrength;
    if (typeof strength === "number" && strength >= 0.0) {
      options.emissiveStrength = strength;
    } else {
      // Default if extension is absent or invalid
      options.emissiveStrength = options.emissiveStrength ?? 1.0;
    }

    // Spec exclusion: must not be used with KHR_materials_unlit
    if (matExt?.KHR_materials_unlit) {
      if (options.emissiveStrength !== 1.0) {
        console.warn(
          "KHR_materials_emissive_strength present with KHR_materials_unlit; forcing emissiveStrength = 1.0 per spec.",
        );
      }
      options.emissiveStrength = 1.0;
    }

    // KHR_materials_specular
    const specExt = matExt?.KHR_materials_specular;
    if (specExt) {
      options.specularFactor = specExt.specularFactor;
      options.specularColorFactor = specExt.specularColorFactor;
      options.specularFactorUV = specExt.specularTexture?.texCoord ?? 0;
      options.specularColorUV = specExt.specularColorTexture?.texCoord ?? 0;

      if (specExt.specularTexture) {
        options.specularFactorMap = this.getImageUri(
          gltf,
          specExt.specularTexture.index,
          baseUri,
        );
      }
      if (specExt.specularColorTexture) {
        options.specularColorMap = this.getImageUri(
          gltf,
          specExt.specularColorTexture.index,
          baseUri,
        );
      }
    }

    return options;
  }

  /**
   * Recursively instantiates a glTF node and its children into the ECS world.
   *
   * @remarks
   * This function traverses the glTF node hierarchy, creating a corresponding
   * `Entity` for each node and establishing the correct parent-child
   * relationships. It applies the node's transform, and if a mesh is present,
   * it resolves the mesh and material resources to create a
   * `MeshRendererComponent`. It uses a context object to manage caches for
   * materials and samplers, ensuring that resources are reused efficiently.
   *
   * @param world The `World` instance where the scene entities will be
   *     created.
   * @param gltf The parsed glTF asset containing all node, mesh,
   *     and material definitions.
   * @param nodeIndex The index of the node within the glTF file to
   *     instantiate.
   * @param parentEntity The parent entity in the ECS hierarchy to
   *     which the new node's entity will be attached.
   * @param ctx The context object holding caches and
   *     shared data for the entire scene instantiation process.
   * @returns A promise that resolves when the node and all its
   *     descendants have been instantiated.
   */
  private async instantiateNode(
    world: World,
    gltf: ParsedGLTF,
    nodeIndex: number,
    parentEntity: Entity,
    ctx: NodeInstantiationContext,
  ): Promise<void> {
    const node = gltf.json.nodes?.[nodeIndex];
    if (!node) {
      throw new Error(`Node ${nodeIndex} not found in glTF file.`);
    }
    const entity = world.createEntity(node.name ?? `node_${nodeIndex}`);
    ctx.nodeToEntityMap.set(nodeIndex, entity);

    const transform = new TransformComponent();
    if (node.matrix) {
      const pos = vec3.create();
      mat4.getTranslation(node.matrix as mat4, pos);
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

    if (node.mesh !== undefined) {
      const gltfMesh = gltf.json.meshes?.[node.mesh];
      if (!gltfMesh) {
        throw new Error(`Mesh ${node.mesh} not found in glTF file.`);
      }
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

        const meshCacheKey = `GLTF:${gltf.json.asset.version}#mesh${node.mesh}#primitive${i}`;
        const mesh = await this.createMeshFromPrimitive(
          meshCacheKey,
          gltf,
          primitive,
        );

        const matIndex = primitive.material;
        let materialInstance: MaterialInstance | undefined;
        let sampler: GPUSampler = this.defaultSampler;

        if (matIndex !== undefined) {
          if (!ctx.materialToEntitiesMap.has(matIndex)) {
            ctx.materialToEntitiesMap.set(matIndex, []);
          }
          ctx.materialToEntitiesMap.get(matIndex)!.push(primitiveEntity);

          const isAnimated = ctx.animatedMaterialIndices.has(matIndex);
          const gltfMat = gltf.json.materials?.[matIndex];
          if (!gltfMat) {
            throw new Error(`Material ${matIndex} not found in glTF file.`);
          }

          // Determine which sampler to use for this material.
          // We'll use the sampler from the baseColorTexture if available, as it's a common case.
          const baseColorTextureIndex =
            gltfMat.pbrMetallicRoughness?.baseColorTexture?.index;
          if (baseColorTextureIndex !== undefined) {
            const textureDef = gltf.json.textures?.[baseColorTextureIndex];
            sampler = this.getGLTFSampler(gltf, textureDef?.sampler);
          }

          const options = this._getGLTFMaterialOptions(
            gltfMat,
            gltf,
            ctx.baseUri,
          );

          if (isAnimated) {
            materialInstance = await this.createPBRMaterialInstance(
              ctx.materialTemplates[matIndex],
              options,
              sampler,
            );
          } else {
            const staticCacheKey = `${matIndex}-${sampler.label ?? "default"}`;
            materialInstance =
              ctx.staticMaterialInstanceCache.get(staticCacheKey);
            if (!materialInstance) {
              materialInstance = await this.createPBRMaterialInstance(
                ctx.materialTemplates[matIndex],
                options,
                sampler,
              );
              ctx.staticMaterialInstanceCache.set(
                staticCacheKey,
                materialInstance,
              );
            }
          }
        }

        if (!materialInstance) {
          const staticCacheKey = `-1-${this.defaultSampler.label}`;
          materialInstance =
            ctx.staticMaterialInstanceCache.get(staticCacheKey);
          if (!materialInstance) {
            const defaultTemplate = await this.createPBRMaterialTemplate({});
            materialInstance = await this.createPBRMaterialInstance(
              defaultTemplate,
              {},
              this.defaultSampler,
            );
            ctx.staticMaterialInstanceCache.set(
              staticCacheKey,
              materialInstance,
            );
          }
        }
        world.addComponent(
          primitiveEntity,
          new MeshRendererComponent(mesh, materialInstance),
        );
      }
    }

    if (node.children) {
      for (const childNodeIndex of node.children) {
        await this.instantiateNode(world, gltf, childNodeIndex, entity, ctx);
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
      return image.uri.startsWith("data:")
        ? image.uri
        : new URL(image.uri, baseUri).href;
    }
    if (image.bufferView !== undefined && image.mimeType) {
      const bufferView = gltf.json.bufferViews?.[image.bufferView];
      if (!bufferView) {
        throw new Error(
          `BufferView ${image.bufferView} not found in glTF file.`,
        );
      }
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

  public async createMeshFromPrimitive(
    key: string,
    gltf: ParsedGLTF,
    primitive: GLTFPrimitive,
  ): Promise<Mesh> {
    const cachedMesh = this.meshes.get(key);
    if (cachedMesh) {
      return cachedMesh;
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
    return this.createMesh(key, meshData);
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
    if (!DEBUG_MESH_VALIDATION) return;
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
    const cachedMesh = this.meshes.get(key);
    if (cachedMesh) {
      return cachedMesh;
    }

    const hasTexCoords = data.texCoords && data.texCoords.length > 0;
    const hasNormals = data.normals && data.normals.length > 0;
    let canGenerateTangents =
      hasTexCoords && hasNormals && data.positions.length > 0;

    let finalPositions = data.positions;
    let finalNormals = data.normals;
    let finalTexCoords = data.texCoords;
    const finalTexCoords1 = data.texCoords1;
    let finalTangents: Float32Array | undefined;
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

          // Bounds checking
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

    // --- Buffer 4: Texture Coordinates 1 (shaderLocation: 9) ---
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

    const mesh: Mesh & { id?: number } = {
      buffers: finalBuffers,
      layouts: finalLayouts,
      vertexCount: finalVertexCount,
      indexBuffer,
      indexCount: finalIndices?.length,
      indexFormat: finalIndices instanceof Uint16Array ? "uint16" : "uint32",
      aabb,
    };

    mesh.id = ResourceManager.nextMeshId++;

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

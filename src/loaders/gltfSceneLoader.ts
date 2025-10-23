// src/loaders/gltfSceneLoader.ts
import {
  AnimationClip,
  AnimationChannel,
  AnimationSampler,
} from "@/core/types/animation";
import { PBRMaterial } from "@/core/materials/pbrMaterial";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { ResourceManager } from "@/core/resources/resourceManager";
import { World } from "@/core/ecs/world";
import { Entity } from "@/core/ecs/entity";
import {
  GLTFMaterial,
  ParsedGLTF,
  getAccessorData,
} from "@/loaders/gltfLoader";
import { PBRMaterialOptions } from "@/core/types/gpu";
import { MeshRendererComponent } from "@/core/ecs/components/meshRendererComponent";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { AnimationComponent } from "@/core/ecs/components/animationComponent";
import { setParent } from "@/core/ecs/utils/hierarchy";
import { mat4, quat, vec3 } from "wgpu-matrix";
import { ResourceHandle } from "@/core/resources/resourceHandle";
import { createMaterialCacheKey } from "@/core/utils/material";

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
 * Handles the instantiation of a parsed GLTF asset into an ECS scene.
 *
 * This class is responsible for traversing the glTF scene graph, creating
 * corresponding entities in the world, and attaching the necessary components
 * like Transforms, MeshRenderers, and Animations. It relies on the
 * ResourceManager to resolve and create the final GPU assets.
 */
export class GltfSceneLoader {
  private resourceManager: ResourceManager;
  private world: World;

  /**
   * Constructs a new GltfSceneLoader.
   *
   * @param world The ECS World where entities will be created.
   * @param resourceManager The resource manager used to resolve meshes,
   *     materials, and other GPU assets.
   */
  constructor(world: World, resourceManager: ResourceManager) {
    this.world = world;
    this.resourceManager = resourceManager;
  }

  /**
   * Instantiates a parsed glTF asset into the world and returns the root entity.
   *
   * @remarks
   * The process involves three main stages:
   * 1.  **Pre-analysis**: It first scans materials and animations to build
   *     templates and identify which resources need special handling.
   * 2.  **Scene Instantiation**: It recursively traverses the glTF nodes,
   *     creating an entity for each one and setting up the parent-child
   *     hierarchy. Multi-primitive meshes are handled by creating a single
   *     entity with a MeshRendererComponent containing an array of meshes.
   * 3.  **Animation Parsing**: It parses all animation clips and their channels,
   *     linking them to the newly created entities.
   *
   * @param gltf - The fully parsed glTF asset.
   * @param baseUri - The base URI of the loaded glTF file.
   * @returns A promise that resolves to the root `Entity`.
   */
  public async load(gltf: ParsedGLTF, baseUri: string): Promise<Entity> {
    // --- Step 1: Pre-analysis and Asset Creation ---
    const materialTemplates: PBRMaterial[] = [];
    if (gltf.json.materials) {
      for (const mat of gltf.json.materials) {
        const pbr = mat.pbrMetallicRoughness ?? {};
        const options: PBRMaterialOptions = { albedo: pbr.baseColorFactor };
        const template =
          await this.resourceManager.createPBRMaterialTemplate(options);
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
    const sceneRootEntity = this.world.createEntity("gltf_scene_root");
    this.world.addComponent(sceneRootEntity, new TransformComponent());

    const context: NodeInstantiationContext = {
      gltf,
      baseUri,
      materialTemplates,
      animatedMaterialIndices,
      nodeToEntityMap: new Map<number, Entity>(),
      materialToEntitiesMap: new Map<number, Entity[]>(),
      staticMaterialInstanceCache: new Map<string, MaterialInstance>(),
    };

    for (const nodeIndex of scene.nodes) {
      await this.instantiateNode(nodeIndex, sceneRootEntity, context);
    }

    // --- Step 3: Animation Parsing ---
    this.parseAnimations(sceneRootEntity, context);

    return sceneRootEntity;
  }

  /**
   * Recursively instantiates a single glTF node and its children into the ECS.
   *
   * @remarks
   * If a node contains a mesh, it resolves the entire mesh (all primitives) at once
   * and creates a single `MeshRendererComponent` on the node's entity. This aligns
   * with the engine's architecture for handling multi-primitive meshes.
   *
   * @param nodeIndex - The index of the node to instantiate.
   * @param parentEntity - The parent `Entity` in the ECS.
   * @param ctx - The shared context object.
   * @returns A promise that resolves when the node and its descendants are instantiated.
   */
  private async instantiateNode(
    nodeIndex: number,
    parentEntity: Entity,
    ctx: NodeInstantiationContext,
  ): Promise<void> {
    const node = ctx.gltf.json.nodes?.[nodeIndex];
    if (!node) {
      throw new Error(`Node ${nodeIndex} not found in glTF file.`);
    }
    const entity = this.world.createEntity(node.name ?? `node_${nodeIndex}`);
    ctx.nodeToEntityMap.set(nodeIndex, entity);

    const transform = new TransformComponent();
    if (node.matrix) {
      // todo: Implement full matrix decomposition to T/R/S
      const pos = vec3.create();
      mat4.getTranslation(node.matrix, pos);
      transform.setPosition(pos);
    } else {
      if (node.translation)
        transform.setPosition(vec3.fromValues(...node.translation));
      if (node.rotation)
        transform.setRotation(quat.fromValues(...node.rotation));
      if (node.scale) transform.setScale(vec3.fromValues(...node.scale));
    }
    this.world.addComponent(entity, transform);
    setParent(this.world, entity, parentEntity);

    if (node.mesh !== undefined) {
      const gltfMesh = ctx.gltf.json.meshes?.[node.mesh];
      if (!gltfMesh || gltfMesh.primitives.length === 0) {
        throw new Error(`Mesh ${node.mesh} not found or has no primitives.`);
      }

      const meshName = gltfMesh.name ?? `mesh_${node.mesh}`;
      const meshHandle = ResourceHandle.forGltfMesh(ctx.baseUri, meshName);

      // RESOLVE ALL MESH PRIMITIVES AT ONCE
      const meshes = await this.resourceManager.resolveMeshByHandle(meshHandle);
      if (!meshes) {
        console.error(`Failed to load mesh ${meshName} for node ${node.name}`);
        return;
      }

      // PREPARE MATERIALS AND OVERRIDES
      const materialOverrides = new Map<number, MaterialInstance>();
      let defaultMaterial: MaterialInstance | undefined;

      for (let i = 0; i < gltfMesh.primitives.length; i++) {
        const primitive = gltfMesh.primitives[i];
        const matIndex = primitive.material;

        if (matIndex === undefined) {
          // Fallback to a default material if no material is specified
          if (i === 0) {
            const defaultMatOptions: PBRMaterialOptions = {
              albedo: [0.8, 0.8, 0.8, 1],
            };
            const defaultMat = await this.resourceManager.resolveMaterialSpec(
              { type: "PBR", options: defaultMatOptions },
              `gltf/default_material`,
            );
            defaultMaterial = defaultMat;
          }
          // Continue to next primitive, as we don't have a specific material to resolve
          continue;
        }

        const gltfMat = ctx.gltf.json.materials?.[matIndex];
        if (!gltfMat) throw new Error(`Material ${matIndex} not found.`);

        const isAnimated = ctx.animatedMaterialIndices.has(matIndex);
        const options = this._getGLTFMaterialOptions(
          gltfMat,
          ctx.gltf,
          ctx.baseUri,
        );

        // Create a unique cache key for this specific material configuration
        const cacheKey = createMaterialCacheKey(options);

        let materialInstance: MaterialInstance | undefined;
        if (isAnimated) {
          // Animated materials are never shared; always create a new instance.
          // They could be cached by their animation target, but that's more complex.
          // Todo: actually do it
          const template = ctx.materialTemplates[matIndex];
          const sampler = this.resourceManager.getGLTFSampler(
            ctx.gltf,
            gltfMat.pbrMetallicRoughness?.baseColorTexture?.index,
          );
          materialInstance =
            await this.resourceManager.createPBRMaterialInstance(
              template,
              options,
              sampler,
            );
        } else {
          // For static materials, use the scene-wide cache
          materialInstance = ctx.staticMaterialInstanceCache.get(cacheKey);
          if (!materialInstance) {
            const template = ctx.materialTemplates[matIndex];
            const sampler = this.resourceManager.getGLTFSampler(
              ctx.gltf,
              gltfMat.pbrMetallicRoughness?.baseColorTexture?.index,
            );
            materialInstance =
              await this.resourceManager.createPBRMaterialInstance(
                template,
                options,
                sampler,
              );
            ctx.staticMaterialInstanceCache.set(cacheKey, materialInstance);
          }
        }

        // Set the first resolved material as the default for the MeshRendererComponent
        if (i === 0) {
          defaultMaterial = materialInstance;
        } else {
          // Subsequent materials are overrides
          materialOverrides.set(i, materialInstance);
        }
      }

      // If we still don't have a default material (e.g., all primitives had no material), create one.
      if (!defaultMaterial) {
        const defaultMatOptions: PBRMaterialOptions = {
          albedo: [0.8, 0.8, 0.8, 1],
        };
        defaultMaterial = await this.resourceManager.resolveMaterialSpec(
          { type: "PBR", options: defaultMatOptions },
          `gltf/default_material_${Date.now()}`, // Ensure unique key
        );
      }

      // CREATE A SINGLE MESH RENDERER COMPONENT
      this.world.addComponent(
        entity,
        new MeshRendererComponent(
          meshes,
          defaultMaterial, // We know defaultMaterial is set
          materialOverrides.size > 0 ? materialOverrides : null,
        ),
      );
    }
  }

  /**
   * Parses all animation clips defined in the glTF and attaches them to the scene root.
   *
   * This method iterates through the animations in the glTF asset, creating an
   * `AnimationClip` for each one. It resolves the animation channels, which
   * target specific entities (for transforms) or materials (for properties),
   * and packages them into a single `AnimationComponent` on the root entity.
   *
   * @remarks
   * The method handles both standard transform animations (translation,
   * rotation, scale) and material property animations via the
   * `KHR_animation_pointer` extension. It relies on the `nodeToEntityMap` and
   * `materialToEntitiesMap` built during the node instantiation phase to link
   * animation channels to their targets.
   *
   * @param sceneRootEntity The root entity of the loaded scene, which will
   *     receive the `AnimationComponent`.
   * @param ctx The shared context object containing the parsed glTF data and
   *     entity mappings.
   */
  private parseAnimations(
    sceneRootEntity: Entity,
    ctx: NodeInstantiationContext,
  ): void {
    const clips: AnimationClip[] = [];
    if (!ctx.gltf.json.animations) return;

    for (const anim of ctx.gltf.json.animations) {
      const channels: AnimationChannel[] = [];
      let duration = 0;

      const samplerCache: AnimationSampler[] = anim.samplers.map((s) => {
        const times = getAccessorData(ctx.gltf, s.input) as Float32Array;
        const values = getAccessorData(ctx.gltf, s.output) as Float32Array;
        if (times.length > 0) {
          duration = Math.max(duration, times[times.length - 1]);
        }
        const outAccessor = ctx.gltf.json.accessors![s.output];
        const stride =
          outAccessor.type === "VEC3" ? 3 : outAccessor.type === "VEC4" ? 4 : 3;
        return {
          times,
          values,
          interpolation: (s.interpolation ?? "LINEAR") as any,
          valueStride: stride,
        };
      });

      for (const ch of anim.channels) {
        const sampler = samplerCache[ch.sampler];
        const pointer = ch.target.extensions?.KHR_animation_pointer?.pointer;

        if (pointer) {
          // KHR_animation_pointer for material properties
          const parts = pointer.split("/");
          if (parts[1] === "materials" && parts.length >= 4) {
            const matIndex = parseInt(parts[2], 10);
            const property = parts.slice(3).join("/");
            const targetEntities = ctx.materialToEntitiesMap.get(matIndex);
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
          // Standard transform animations
          const targetEntity = ctx.nodeToEntityMap.get(ch.target.node);
          if (
            targetEntity &&
            (ch.target.path === "translation" ||
              ch.target.path === "rotation" ||
              ch.target.path === "scale")
          ) {
            channels.push({
              targetEntity,
              path: { component: TransformComponent, property: ch.target.path },
              sampler,
            });
          }
        }
      }
      const clipName = anim.name ?? `GLTF_Animation_${clips.length}`;
      clips.push({ name: clipName, duration, channels });
    }

    if (clips.length > 0) {
      this.world.addComponent(sceneRootEntity, new AnimationComponent(clips));
    }
  }

  /**
   * Builds a `PBRMaterialOptions` object from a glTF material definition.
   *
   * This function translates the properties from a glTF material object into the
   * flat `PBRMaterialOptions` structure used by the engine's MaterialFactory.
   * It resolves texture URIs, extracts material factors, and handles several
   * common PBR-related glTF extensions.
   *
   * @remarks
   * This method supports the following core properties and extensions:
   * - PBR Metallic-Roughness properties and textures.
   * - Normal, Occlusion, and Emissive maps with their associated factors.
   * - `KHR_materials_emissive_strength` for controlling emissive intensity.
   * - `KHR_materials_specular` for specular workflow properties.
   * - A heuristic for packed Occlusion-Roughness-Metallic (ORM) textures.
   *
   * @param gltfMat The glTF material object from the parsed JSON.
   * @param gltf The complete parsed glTF asset, used to resolve texture data.
   * @param baseUri The base URI for resolving relative texture paths.
   * @returns A `PBRMaterialOptions` object ready to be passed to the
   *     `ResourceManager`.
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

    // --- Extensions ---
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
   * Resolves the URI for a glTF image, handling external files and embedded data.
   *
   * This utility function determines the correct, fully-qualified URL for a
   * texture. It can handle standard relative file paths, base64-encoded data
   * URIs, and images embedded directly in the glTF's binary buffer.
   *
   * @remarks
   * It also handles the `KHR_texture_basisu` extension by prioritizing
   * its `source` index over the standard texture `source`. When an image is
   * embedded as a buffer view, it creates a `Blob` and returns its object URL.
   *
   * @param gltf The complete parsed glTF asset.
   * @param textureIndex The index of the texture in the glTF's `textures` array.
   * @param baseUri The base URI for resolving relative file paths.
   * @returns A string containing the resolved URI, or `undefined` if the
   *     texture or image source cannot be found.
   */
  private getImageUri(
    gltf: ParsedGLTF,
    textureIndex: number,
    baseUri: string,
  ): string | undefined {
    const { json, buffers } = gltf;
    const texture = json.textures?.[textureIndex];
    if (!texture) return undefined;

    // Check for the Basis extension first (KHR_texture_basisu). If it exists,
    // its source is the one we must use.
    const basisExtension = texture.extensions?.KHR_texture_basisu;
    const sourceIndex = basisExtension ? basisExtension.source : texture.source;
    if (sourceIndex === undefined) return undefined;

    const image = json.images?.[sourceIndex];
    if (!image) return undefined;

    if (image.uri) {
      return image.uri.startsWith("data:")
        ? image.uri
        : new URL(image.uri, baseUri).href;
    }
    if (image.bufferView !== undefined && image.mimeType) {
      const bufferView = gltf.json.bufferViews?.[image.bufferView];
      if (!bufferView)
        throw new Error(`BufferView ${image.bufferView} not found.`);
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
}

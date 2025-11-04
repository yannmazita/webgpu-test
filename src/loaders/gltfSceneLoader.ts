// src/loaders/gltfSceneLoader.ts
import {
  AnimationClip,
  AnimationChannel,
  AnimationSampler,
} from "@/core/types/animation";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { World } from "@/core/ecs/world";
import { Entity } from "@/core/ecs/entity";
import {
  GLTFMaterial,
  ParsedGLTF,
  getAccessorData,
} from "@/loaders/gltfLoader";
import { PBRMaterialOptions } from "@/core/types/gpu";
import { MeshRendererComponent } from "@/core/ecs/components/render/meshRendererComponent";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { AnimationComponent } from "@/core/ecs/components/animationComponent";
import { setParent } from "@/core/ecs/utils/hierarchy";
import { mat3, mat4, quat, vec3 } from "wgpu-matrix";
import { createMaterialSpecKey } from "@/core/utils/material";
import { ResourceHandle } from "@/core/resources/resourceHandle";
import { PBRMaterialSpecComponent } from "@/core/ecs/components/resources/materialSpecComponent";
import {
  MaterialResourceComponent,
  MeshResourceComponent,
} from "@/core/ecs/components/resources/resourceComponents";
import { ResourceCacheComponent } from "@/core/ecs/components/resources/resourceCacheComponent";
import { PBRMaterialSpec } from "@/core/types/material";

interface NodeInstantiationContext {
  gltf: ParsedGLTF;
  baseUri: string;
  nodeToEntityMap: Map<number, Entity>;
  animatedMaterialIndices: Set<number>;
  materialToEntitiesMap: Map<number, Entity[]>;
}

/**
 * Handles the instantiation of a parsed GLTF asset into an ECS scene.
 * @remarks
 * This class is responsible for traversing the glTF scene graph, creating
 * corresponding entities in the world, and attaching the necessary components
 * like Transforms, MeshRenderers, and Animations. It uses the ECS resource
 * pattern, creating entities with resource components to declaratively trigger
 * asset loading via the `ResourceLoadingSystem`.
 */
export class GltfSceneLoader {
  private world: World;

  /**
   * @param world - The ECS World where entities will be created.
   * @param renderer - The main renderer instance, used for device access.
   */
  constructor(world: World) {
    this.world = world;
  }

  public async load(gltf: ParsedGLTF, baseUri: string): Promise<Entity> {
    const sceneIndex = gltf.json.scene ?? 0;
    const scene = gltf.json.scenes?.[sceneIndex];
    if (!scene) throw new Error(`Scene not found in glTF file.`);

    // --- Pre-analysis for Material Animations ---
    const animatedMaterialIndices = new Set<number>();
    if (gltf.json.animations) {
      for (const anim of gltf.json.animations) {
        for (const channel of anim.channels) {
          const pointer =
            channel.target.extensions?.KHR_animation_pointer?.pointer;
          if (pointer?.startsWith("/materials/")) {
            const parts = pointer.split("/");
            if (parts.length >= 3) {
              animatedMaterialIndices.add(parseInt(parts[2], 10));
            }
          }
        }
      }
    }

    const sceneRootEntity = this.world.createEntity("gltf_scene_root");
    this.world.addComponent(sceneRootEntity, new TransformComponent());

    const context: NodeInstantiationContext = {
      gltf,
      baseUri,
      nodeToEntityMap: new Map<number, Entity>(),
      animatedMaterialIndices,
      materialToEntitiesMap: new Map<number, Entity[]>(),
    };

    for (const nodeIndex of scene.nodes) {
      await this.instantiateNode(nodeIndex, sceneRootEntity, context);
    }

    this.parseAnimations(sceneRootEntity, context);
    return sceneRootEntity;
  }

  private async instantiateNode(
    nodeIndex: number,
    parentEntity: Entity,
    ctx: NodeInstantiationContext,
  ): Promise<void> {
    const node = ctx.gltf.json.nodes?.[nodeIndex];
    if (!node) throw new Error(`Node ${nodeIndex} not found in glTF file.`);

    const entity = this.world.createEntity(node.name ?? `node_${nodeIndex}`);
    ctx.nodeToEntityMap.set(nodeIndex, entity);

    const transform = new TransformComponent();
    if (node.matrix) {
      mat4.getTranslation(node.matrix, transform.position);
      mat4.getScaling(node.matrix, transform.scale);
      const rotationMatrix = mat3.fromMat4(node.matrix);
      const invScale = vec3.create(
        1.0 / transform.scale[0],
        1.0 / transform.scale[1],
        1.0 / transform.scale[2],
      );
      mat3.scale(rotationMatrix, invScale, rotationMatrix);
      quat.fromMat(rotationMatrix, transform.rotation);
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
      if (!gltfMesh) throw new Error(`Mesh ${node.mesh} not found.`);

      const meshName = gltfMesh.name ?? `mesh_${node.mesh}`;
      const meshHandle = ResourceHandle.forMesh(
        `GLTF:${ctx.baseUri}#${meshName}`,
      );
      this.world.addComponent(entity, new MeshResourceComponent(meshHandle));

      const materialHandles: ResourceHandle<MaterialInstance>[] = [];
      for (const primitive of gltfMesh.primitives) {
        const matIndex = primitive.material;
        let materialHandle: ResourceHandle<MaterialInstance>;

        if (matIndex !== undefined) {
          const gltfMat = ctx.gltf.json.materials?.[matIndex];
          if (!gltfMat) throw new Error(`Material ${matIndex} not found.`);

          const options = this._getGLTFMaterialOptions(
            gltfMat,
            ctx.gltf,
            ctx.baseUri,
          );
          const spec: PBRMaterialSpec = { type: "PBR", options };
          const key = createMaterialSpecKey(spec);
          materialHandle = ResourceHandle.forMaterial(key);

          const cache = this.world.getResource(ResourceCacheComponent);
          if (!cache?.has(key)) {
            const matEntity = this.world.createEntity(
              `material_resource_${key}`,
            );
            this.world.addComponent(
              matEntity,
              new PBRMaterialSpecComponent(spec),
            );
            this.world.addComponent(matEntity, new MaterialResourceComponent());
          }

          // Track which entities use this material for animation targeting
          if (!ctx.materialToEntitiesMap.has(matIndex)) {
            ctx.materialToEntitiesMap.set(matIndex, []);
          }
          ctx.materialToEntitiesMap.get(matIndex)?.push(entity);
        } else {
          const defaultSpec: PBRMaterialSpec = {
            type: "PBR",
            options: { albedo: [0.8, 0.8, 0.8, 1.0] },
          };
          const key = createMaterialSpecKey(defaultSpec);
          materialHandle = ResourceHandle.forMaterial(key);
          const cache = this.world.getResource(ResourceCacheComponent);
          if (!cache?.has(key)) {
            const matEntity = this.world.createEntity(
              "default_material_resource",
            );
            this.world.addComponent(
              matEntity,
              new PBRMaterialSpecComponent(defaultSpec),
            );
            this.world.addComponent(matEntity, new MaterialResourceComponent());
          }
        }
        materialHandles.push(materialHandle);
      }

      const defaultMaterialHandle = materialHandles[0];
      const materialOverrides = new Map<
        number,
        ResourceHandle<MaterialInstance>
      >();
      for (let i = 1; i < materialHandles.length; i++) {
        materialOverrides.set(i, materialHandles[i]);
      }
      this.world.addComponent(
        entity,
        new MeshRendererComponent(
          meshHandle,
          defaultMaterialHandle,
          materialOverrides,
        ),
      );
    }

    if (node.children) {
      for (const childIndex of node.children) {
        await this.instantiateNode(childIndex, entity, ctx);
      }
    }
  }

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
          interpolation: s.interpolation ?? "LINEAR",
          valueStride: stride,
        };
      });

      for (const ch of anim.channels) {
        const sampler = samplerCache[ch.sampler];
        const pointer = ch.target.extensions?.KHR_animation_pointer?.pointer;

        if (pointer) {
          // RESTORED: KHR_animation_pointer for material properties
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

  private _getGLTFMaterialOptions(
    gltfMat: GLTFMaterial,
    gltf: ParsedGLTF,
    baseUri: string,
  ): PBRMaterialOptions {
    const pbr = gltfMat.pbrMetallicRoughness ?? {};
    const matExt = gltfMat.extensions;
    const options: PBRMaterialOptions = {
      albedo: pbr.baseColorFactor,
      metallic: pbr.metallicFactor,
      roughness: pbr.roughnessFactor,
      emissive: gltfMat.emissiveFactor,
      normalIntensity: gltfMat.normalTexture?.scale,
      occlusionStrength: gltfMat.occlusionTexture?.strength,
      albedoUV: pbr.baseColorTexture?.texCoord ?? 0,
      metallicRoughnessUV: pbr.metallicRoughnessTexture?.texCoord ?? 0,
      normalUV: gltfMat.normalTexture?.texCoord ?? 0,
      emissiveUV: gltfMat.emissiveTexture?.texCoord ?? 0,
      occlusionUV: gltfMat.occlusionTexture?.texCoord ?? 0,
      emissiveStrength: 1.0,
    };

    if (pbr.baseColorTexture)
      options.albedoMap = this.getImageUri(
        gltf,
        pbr.baseColorTexture.index,
        baseUri,
      );
    if (pbr.metallicRoughnessTexture)
      options.metallicRoughnessMap = this.getImageUri(
        gltf,
        pbr.metallicRoughnessTexture.index,
        baseUri,
      );
    if (gltfMat.normalTexture)
      options.normalMap = this.getImageUri(
        gltf,
        gltfMat.normalTexture.index,
        baseUri,
      );
    if (gltfMat.emissiveTexture)
      options.emissiveMap = this.getImageUri(
        gltf,
        gltfMat.emissiveTexture.index,
        baseUri,
      );
    if (gltfMat.occlusionTexture)
      options.occlusionMap = this.getImageUri(
        gltf,
        gltfMat.occlusionTexture.index,
        baseUri,
      );

    if (options.metallicRoughnessMap && !options.occlusionMap) {
      options.usePackedOcclusion = true;
    }

    const strength = matExt?.KHR_materials_emissive_strength?.emissiveStrength;
    if (typeof strength === "number" && strength >= 0.0) {
      options.emissiveStrength = strength;
    }

    return options;
  }

  private getImageUri(
    gltf: ParsedGLTF,
    textureIndex: number,
    baseUri: string,
  ): string | undefined {
    const { json, buffers } = gltf;
    const texture = json.textures?.[textureIndex];
    if (!texture) return undefined;

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

// src/core/ecs/systems/render/renderSystem.ts
import { Renderer } from "@/core/rendering/renderer";
import { SceneRenderData } from "@/core/types/rendering";
import { vec4 } from "wgpu-matrix";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { LightComponent } from "@/core/ecs/components/lightComponent";
import { MeshRendererComponent } from "@/core/ecs/components/render/meshRendererComponent";
import { MainCameraTagComponent } from "@/core/ecs/components/tagComponents";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { World } from "@/core/ecs/world";
import { SkyboxComponent } from "@/core/ecs/components/skyboxComponent";
import { IBLComponent } from "@/core/ecs/components/iblComponent";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/sunComponent";
import { FogComponent } from "@/core/ecs/components/fogComponent";
import { ResourceCacheComponent } from "@/core/ecs/components/resources/resourceCacheComponent";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { ResourceHandle } from "@/core/resources/resourceHandle";

/**
 * Gathers all necessary data and orchestrates the rendering of a single frame.
 *
 * @remarks
 * This system acts as the bridge between the ECS world and the low-level
 * renderer. It queries for all visible objects, resolves their resource
 * handles from the `ResourceCacheComponent`, and packages the ready-to-render
 * data into a `SceneRenderData` object. If a renderable entity's resources
 * (mesh or material) are not yet loaded, it is simply skipped for that frame.
 *
 * @param world - The ECS world containing the scene's entities.
 * @param renderer - The main renderer instance that will draw the scene.
 * @param sceneData - A pre-allocated data structure to be filled with this
 *     frame's renderable objects and scene properties.
 * @param postSceneDrawCallback - An optional callback for post-scene drawing.
 */
export function renderSystem(
  world: World,
  renderer: Renderer,
  sceneData: SceneRenderData,
  postSceneDrawCallback?: (passEncoder: GPURenderPassEncoder) => void,
): void {
  // Find the main camera
  const cameraQuery = world.query([CameraComponent, MainCameraTagComponent]);
  if (cameraQuery.length === 0) {
    console.warn("RenderSystem: No main camera found. Skipping render.");
    return;
  }
  const cameraComponent = world.getComponent(cameraQuery[0], CameraComponent);
  if (!cameraComponent) {
    console.warn("RenderSystem: Camera component not found. Skipping render.");
    return;
  }

  // Get the global resource cache
  const cache = world.getOrAddResource(ResourceCacheComponent);

  // Clear the reusable data container for the new frame's data
  sceneData.clear();

  // Skybox
  const skyboxComp = world.getResource(SkyboxComponent);
  if (skyboxComp) {
    sceneData.skyboxMaterial = skyboxComp.material;
  }

  // IBL
  const iblComp = world.getResource(IBLComponent);
  if (iblComp) {
    sceneData.iblComponent = iblComp;
    sceneData.prefilteredMipLevels = iblComp.prefilteredMap.mipLevelCount;
  }

  // Sun and Shadows
  const sun = world.getResource(SceneSunComponent);
  const shadowSettings = world.getResource(ShadowSettingsComponent);

  // Collect all lights
  const lightQuery = world.query([LightComponent, TransformComponent]);
  for (const entity of lightQuery) {
    const lightComp = world.getComponent(entity, LightComponent);
    const transform = world.getComponent(entity, TransformComponent);

    if (!lightComp || !transform) continue;

    lightComp.light.position[0] = transform.worldMatrix[12];
    lightComp.light.position[1] = transform.worldMatrix[13];
    lightComp.light.position[2] = transform.worldMatrix[14];
    sceneData.lights.push(lightComp.light);
  }

  // Fog
  const fog = world.getResource(FogComponent);
  if (fog?.enabled) {
    sceneData.fogEnabled = true;
    vec4.copy(fog.color, sceneData.fogColor);
    sceneData.fogDensity = fog.density;
    sceneData.fogHeight = fog.height;
    sceneData.fogHeightFalloff = fog.heightFalloff;
    sceneData.fogInscatteringIntensity = fog.inscatteringIntensity;
  } else {
    sceneData.fogEnabled = false;
  }

  // Collect all renderables
  const renderableQuery = world.query([
    TransformComponent,
    MeshRendererComponent,
  ]);

  for (const entity of renderableQuery) {
    const transform = world.getComponent(entity, TransformComponent);
    const meshRenderer = world.getComponent(entity, MeshRendererComponent);

    if (!transform || !meshRenderer) continue;

    // --- Resolve Handles from Cache ---
    const meshAsset = cache.getMesh(meshRenderer.meshHandle.key);
    if (!meshAsset) {
      // Mesh not loaded yet, skip this entity for this frame.
      continue;
    }
    const meshes = Array.isArray(meshAsset) ? meshAsset : [meshAsset];

    const getMaterialFromHandle = (
      handle: ResourceHandle<MaterialInstance>,
    ): MaterialInstance | undefined => {
      return cache.getMaterial(handle.key);
    };

    const defaultMaterial = getMaterialFromHandle(meshRenderer.materialHandle);
    if (!defaultMaterial) {
      // Default material not loaded yet, skip.
      continue;
    }

    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      if (typeof mesh?.aabb === "undefined") {
        console.error(
          "CRITICAL ERROR in renderSystem: Invalid mesh found for entity",
          entity,
          mesh,
        );
        continue;
      }

      let material = defaultMaterial;
      const overrideHandle = meshRenderer.materialOverrides?.get(i);
      if (overrideHandle) {
        const overrideMaterial = getMaterialFromHandle(overrideHandle);
        if (overrideMaterial) {
          material = overrideMaterial;
        } else {
          // Override material not loaded yet, skip this sub-mesh.
          continue;
        }
      }

      sceneData.renderables.push({
        mesh: mesh,
        material: material,
        modelMatrix: transform.worldMatrix,
        isUniformlyScaled: transform.isUniformlyScaled,
        castShadows: meshRenderer.castShadows,
        receiveShadows: meshRenderer.receiveShadows,
      });
    }
  }

  renderer.render(
    cameraComponent,
    sceneData,
    postSceneDrawCallback,
    sun,
    shadowSettings,
  );
}

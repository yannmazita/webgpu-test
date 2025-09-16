// src/core/ecs/systems/renderSystem.ts
import { Renderer } from "@/core/renderer";
import { SceneRenderData } from "@/core/types/rendering";
import { vec4, Vec4 } from "wgpu-matrix";
import { CameraComponent } from "../components/cameraComponent";
import { LightComponent } from "../components/lightComponent";
import { MeshRendererComponent } from "../components/meshRendererComponent";
import { MainCameraTagComponent } from "../components/tagComponents";
import { TransformComponent } from "../components/transformComponent";
import { World } from "../world";
import { SkyboxComponent } from "../components/skyboxComponent";
import { IBLComponent } from "../components/iblComponent";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "../components/sunComponent";

// A global resource for scene properties
export class SceneLightingComponent {
  // Volumetric Fog configuration
  public fogColor: Vec4 = vec4.fromValues(0.5, 0.6, 0.7, 1.0); // Ambient in-scattering term
  public fogDensity = 0.02;
  public fogHeight = 0.0;
  public fogHeightFalloff = 0.1;
  public fogInscatteringIntensity = 0.8; // Sun scattering contribution
}

/**
 * Gathers all necessary data and orchestrates the rendering of a single frame.
 *
 * This system acts as the bridge between the ECS world and the low-level
 * renderer. It queries the world for all visible objects (lights, meshes),
 * collects scene-wide settings like lighting, and packages this data into a
 * `SceneRenderData` object. This object is then passed to the `Renderer` to
 * perform the actual GPU commands.
 *
 * @param world The ECS world containing the scene's entities.
 * @param renderer The main renderer instance that will draw the scene.
 * @param sceneData A pre-allocated data structure to be filled with this
 *     frame's renderable objects and scene properties. Reusing this object
 *     avoids allocations every frame.
 * @param postSceneDrawCallback An optional callback function that allows for
 *     drawing UI or other overlays after the main scene has been rendered.
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
  const cameraComponent = world.getComponent(cameraQuery[0], CameraComponent)!;

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
    const lightComp = world.getComponent(entity, LightComponent)!;
    const transform = world.getComponent(entity, TransformComponent)!;

    // Update light position from its transform's world matrix
    lightComp.light.position[0] = transform.worldMatrix[12];
    lightComp.light.position[1] = transform.worldMatrix[13];
    lightComp.light.position[2] = transform.worldMatrix[14];

    sceneData.lights.push(lightComp.light);
  }

  // Fog
  const sceneLighting =
    world.getResource(SceneLightingComponent) ?? new SceneLightingComponent();
  // copy fog
  vec4.copy(sceneLighting.fogColor, sceneData.fogColor);
  sceneData.fogDensity = sceneLighting.fogDensity;
  sceneData.fogHeight = sceneLighting.fogHeight;
  sceneData.fogHeightFalloff = sceneLighting.fogHeightFalloff;
  sceneData.fogInscatteringIntensity = sceneLighting.fogInscatteringIntensity;

  // Collect all renderables
  const renderableQuery = world.query([
    TransformComponent,
    MeshRendererComponent,
  ]);

  for (const entity of renderableQuery) {
    const transform = world.getComponent(entity, TransformComponent)!;
    const meshRenderer = world.getComponent(entity, MeshRendererComponent)!;

    if (typeof meshRenderer.mesh?.aabb === "undefined") {
      console.error(
        "CRITICAL ERROR in renderSystem: Invalid mesh found for entity",
        entity,
        meshRenderer.mesh,
      );
    }

    sceneData.renderables.push({
      mesh: meshRenderer.mesh,
      material: meshRenderer.material,
      modelMatrix: transform.worldMatrix,
      isUniformlyScaled: transform.isUniformlyScaled,
      castShadows: meshRenderer.castShadows,
      receiveShadows: meshRenderer.receiveShadows,
    });
  }

  renderer.render(
    cameraComponent,
    sceneData,
    postSceneDrawCallback,
    sun,
    shadowSettings,
  );
}

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
import { SkyboxMaterial } from "@/core/materials/skyboxMaterial";

// A global resource for scene properties
export class SceneLightingComponent {
  public ambientColor: Vec4 = vec4.fromValues(0.1, 0.1, 0.1, 1.0);

  // fog config (defaults off)
  public fogColor: Vec4 = vec4.fromValues(0.6, 0.7, 0.8, 1.0);
  // [distanceDensity, height, heightFalloff, enableFlags]
  public fogParams0: Vec4 = vec4.fromValues(0.0, 0.0, 0.0, 0.0);
  public fogParams1: Vec4 = vec4.fromValues(0.0, 0.0, 0.0, 0.0);
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

  // Get ambient color
  const sceneLighting =
    world.getResource(SceneLightingComponent) ?? new SceneLightingComponent();
  vec4.copy(sceneLighting.ambientColor, sceneData.ambientColor);
  // copy fog
  vec4.copy(sceneLighting.fogColor, sceneData.fogColor);
  vec4.copy(sceneLighting.fogParams0, sceneData.fogParams0);
  vec4.copy(sceneLighting.fogParams1, sceneData.fogParams1);

  // Collect all renderables
  const renderableQuery = world.query([
    TransformComponent,
    MeshRendererComponent,
  ]);

  for (const entity of renderableQuery) {
    const transform = world.getComponent(entity, TransformComponent)!;
    const meshRenderer = world.getComponent(entity, MeshRendererComponent)!;

    sceneData.renderables.push({
      mesh: meshRenderer.mesh,
      material: meshRenderer.material,
      modelMatrix: transform.worldMatrix,
      isUniformlyScaled: transform.isUniformlyScaled,
      normalMatrix: transform.normalMatrix,
    });
  }

  renderer.render(cameraComponent, sceneData, postSceneDrawCallback);
}

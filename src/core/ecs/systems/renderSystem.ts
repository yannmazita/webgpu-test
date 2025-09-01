// src/core/ecs/systems/renderSystem.ts
import { Renderer } from "@/core/renderer";
import { Light, Renderable } from "@/core/types/gpu";
import { SceneRenderData } from "@/core/types/rendering";
import { vec4, Vec4 } from "wgpu-matrix";
import { CameraComponent } from "../components/cameraComponent";
import { LightComponent } from "../components/lightComponent";
import { MeshRendererComponent } from "../components/meshRendererComponent";
import { MainCameraTagComponent } from "../components/tagComponents";
import { TransformComponent } from "../components/transformComponent";
import { World } from "../world";

// A global resource for scene lighting properties
export class SceneLightingComponent {
  public ambientColor: Vec4 = vec4.fromValues(0.1, 0.1, 0.1, 1.0);
}

/**
 * Collects all renderable entities and scene-wide data, then passes it to the Renderer.
 * @param world The world containing the entities.
 * @param renderer The main renderer instance.
 * @param postSceneDrawCallback An optional callback for drawing UI or other overlays.
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
      // Pass the pre-computed normal matrix and isUniformlyScaled flag
      isUniformlyScaled: transform.isUniformlyScaled,
    });
  }

  renderer.render(cameraComponent, sceneData, postSceneDrawCallback);
}

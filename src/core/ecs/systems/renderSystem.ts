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
  postSceneDrawCallback?: (passEncoder: GPURenderPassEncoder) => void,
): void {
  // Find the main camera
  const cameraQuery = world.query([CameraComponent, MainCameraTagComponent]);
  if (cameraQuery.length === 0) {
    console.warn("RenderSystem: No main camera found. Skipping render.");
    return;
  }
  const camera = world.getComponent(cameraQuery[0], CameraComponent)!.camera;

  // Collect all lights
  const lights: Light[] = [];
  const lightQuery = world.query([LightComponent]);
  for (const entity of lightQuery) {
    lights.push(world.getComponent(entity, LightComponent)!.light);
  }

  // Get ambient color
  const sceneLighting =
    world.getComponent(0, SceneLightingComponent) ??
    new SceneLightingComponent();

  // Collect all renderables
  const renderables: Renderable[] = [];
  const renderableQuery = world.query([
    TransformComponent,
    MeshRendererComponent,
  ]);

  for (const entity of renderableQuery) {
    const transform = world.getComponent(entity, TransformComponent)!;
    const meshRenderer = world.getComponent(entity, MeshRendererComponent)!;

    renderables.push({
      mesh: meshRenderer.mesh,
      material: meshRenderer.material,
      modelMatrix: transform.worldMatrix,
      isUniformlyScaled: transform.isUniformlyScaled,
    });
  }

  const sceneData: SceneRenderData = {
    renderables,
    lights,
    ambientColor: sceneLighting.ambientColor,
  };

  renderer.render(camera, sceneData, postSceneDrawCallback);
}

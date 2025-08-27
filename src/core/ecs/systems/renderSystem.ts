// src/core/ecs/systems/renderSystem.ts
import { Camera } from "@/core/camera";
import { Renderer } from "@/core/renderer";
import { Light, Renderable } from "@/core/types/gpu";
import { SceneRenderData } from "@/core/types/rendering";
import { Vec4 } from "wgpu-matrix";
import { MeshRendererComponent } from "../components/meshRendererComponent";
import { TransformComponent } from "../components/transformComponent";
import { World } from "../world";

/**
 * Collects all renderable entities and scene-wide data, then passes it to the Renderer.
 * @param world The world containing the entities.
 * @param renderer The main renderer instance.
 * @param camera The active camera.
 * @param lights An array of lights in the scene.
 * @param ambientColor The scene's ambient light color.
 * @param postSceneDrawCallback An optional callback for drawing UI or other overlays.
 */
export function renderSystem(
  world: World,
  renderer: Renderer,
  camera: Camera,
  lights: Light[],
  ambientColor: Vec4,
  postSceneDrawCallback?: (passEncoder: GPURenderPassEncoder) => void,
): void {
  const renderables: Renderable[] = [];

  // Query for all entities that can be rendered.
  const query = world.query([TransformComponent, MeshRendererComponent]);

  for (const entity of query) {
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
    ambientColor,
  };

  renderer.render(camera, sceneData, postSceneDrawCallback);
}

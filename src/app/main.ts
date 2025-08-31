// src/app/main.ts
import "@/style.css";
import { Renderer } from "@/core/renderer";
import { ResourceManager } from "@/core/resourceManager";
import { World } from "@/core/ecs/world";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { MainCameraTagComponent } from "@/core/ecs/components/tagComponents";
import { LightComponent } from "@/core/ecs/components/lightComponent";
import { cameraSystem } from "@/core/ecs/systems/cameraSystem";
import { transformSystem } from "@/core/ecs/systems/transformSystem";
import {
  renderSystem,
  SceneLightingComponent,
} from "@/core/ecs/systems/renderSystem";
import { MeshRendererComponent } from "@/core/ecs/components/meshRendererComponent";
import { SceneRenderData } from "@/core/types/rendering";
import { createCubeMeshData } from "@/core/utils/primitives";
import { InputManager } from "@/core/inputManager";
import { ActionManager, ActionMapConfig } from "@/core/actionManager";
import { CameraControllerSystem } from "@/core/ecs/systems/cameraControllerSystem";
import { Profiler } from "@/core/utils/profiler";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) throw new Error("Canvas element not found");

(async () => {
  // Disable profiler logs by default
  Profiler.setEnabled(false);

  // Init renderer (main thread -> hardware adapter)
  const renderer = new Renderer(canvas);
  await renderer.init();

  const resourceManager = new ResourceManager(renderer);
  const world = new World();
  const sceneRenderData = new SceneRenderData();

  // Input setup
  const input = new InputManager(canvas);
  const actionMap: ActionMapConfig = {
    move_vertical: { type: "axis", positiveKey: "KeyW", negativeKey: "KeyS" },
    move_horizontal: { type: "axis", positiveKey: "KeyD", negativeKey: "KeyA" },
    move_y_axis: {
      type: "axis",
      positiveKey: "Space",
      negativeKey: "ShiftLeft",
    },
  };
  const actions = new ActionManager(input, actionMap);
  const cameraController = new CameraControllerSystem(actions);

  // Camera
  const cameraEntity = world.createEntity();
  const camXform = new TransformComponent();
  camXform.setPosition(0, 1, 3);
  world.addComponent(cameraEntity, camXform);
  world.addComponent(
    cameraEntity,
    new CameraComponent(90, canvas.width / canvas.height, 0.1, 100.0),
  );
  world.addComponent(cameraEntity, new MainCameraTagComponent());

  // Scene lighting and lights
  world.addResource(new SceneLightingComponent());

  const light1 = world.createEntity();
  world.addComponent(light1, new TransformComponent());
  world.addComponent(light1, new LightComponent([1, 0, 0, 1]));

  const light2 = world.createEntity();
  world.addComponent(light2, new TransformComponent());
  world.addComponent(light2, new LightComponent([0, 1, 0, 1]));

  // Cube
  const material = await resourceManager.createPhongMaterial({
    baseColor: [1, 0.5, 0.2, 1.0],
    specularColor: [1.0, 1.0, 1.0],
    shininess: 100.0,
  });
  const cubeMesh = resourceManager.createMesh("cube", createCubeMeshData());
  const cubeEntity = world.createEntity();
  world.addComponent(cubeEntity, new TransformComponent());
  world.addComponent(cubeEntity, new MeshRendererComponent(cubeMesh, material));

  // Resize handling (event-driven)
  const sendResize = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // Let renderer handle reconfig on next render() via _handleResize, or call requestResize:
    const cam = world.getComponent(cameraEntity, CameraComponent)!;
    renderer.requestResize(w, h, dpr, cam);
  };
  const ro = new ResizeObserver(sendResize);
  ro.observe(canvas);
  window.addEventListener("resize", sendResize);
  sendResize();

  // RAF loop
  let last = performance.now();
  function tick(now: number) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.5) dt = 0.5;

    // Input & camera
    cameraController.update(world, dt);

    // Animate lights
    const t = now / 1000;
    const r = 3.0;
    const l1 = world.getComponent(light1, TransformComponent)!;
    l1.setPosition(Math.sin(t * 0.7) * r, 2.0, Math.cos(t * 0.7) * r);
    const l2 = world.getComponent(light2, TransformComponent)!;
    l2.setPosition(Math.sin(-t * 0.4) * r, 2.0, Math.cos(-t * 0.4) * r);

    // ECS
    transformSystem(world);
    cameraSystem(world);

    // Render
    renderSystem(world, renderer, sceneRenderData);

    // Input end
    input.lateUpdate();

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})().catch(console.error);

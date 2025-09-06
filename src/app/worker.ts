// src/app/worker.ts
/// <reference lib="webworker" />

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
import {
  createCubeMeshData,
  createIcosphereMeshData,
} from "@/core/utils/primitives";
import { CameraControllerSystem } from "@/core/ecs/systems/cameraControllerSystem";
import { quat } from "wgpu-matrix";
import { IInputSource } from "@/core/iinputSource";
import {
  createInputContext,
  InputContext,
  isKeyDown,
  getAndResetMouseDelta,
  getMousePosition,
  isPointerLocked,
} from "@/core/input";
import {
  createMetricsContext,
  initializeMetrics,
  MetricsContext,
  publishMetrics,
} from "@/core/metrics";
import {
  ActionMapConfig,
  getAxisValue,
  IActionController,
  isActionPressed,
} from "@/core/action";

// Message constants
const MSG_INIT = "INIT";
const MSG_RESIZE = "RESIZE";
const MSG_FRAME = "FRAME";

interface InitMsg {
  type: typeof MSG_INIT;
  canvas: OffscreenCanvas;
  sharedInputBuffer: SharedArrayBuffer;
  sharedMetricsBuffer: SharedArrayBuffer;
}
interface ResizeMsg {
  type: typeof MSG_RESIZE;
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
}
interface FrameMsg {
  type: typeof MSG_FRAME;
  now: number;
}

let renderer: Renderer | null = null;
let resourceManager: ResourceManager | null = null;
let world: World | null = null;
let sceneRenderData: SceneRenderData | null = null;

let cameraEntity = -1;
let light1Entity = -1;
let light2Entity = -1;

let inputContext: InputContext | null = null;
let actionController: IActionController | null = null;
let cameraControllerSystem: CameraControllerSystem | null = null;

let metricsContext: MetricsContext | null = null;
let metricsFrameId = 0;

// State for dt
let lastFrameTime = 0;

async function initWorker(
  offscreen: OffscreenCanvas,
  sharedInputBuffer: SharedArrayBuffer,
  sharedMetricsBuffer: SharedArrayBuffer,
) {
  renderer = new Renderer(offscreen);
  await renderer.init();

  // Metrics setup
  metricsContext = createMetricsContext(sharedMetricsBuffer);
  initializeMetrics(metricsContext);

  // Input setup
  inputContext = createInputContext(sharedInputBuffer);
  const inputReader: IInputSource = {
    isKeyDown: (code: string) => isKeyDown(inputContext!, code),
    getMouseDelta: () => getAndResetMouseDelta(inputContext!),
    getMousePosition: () => getMousePosition(inputContext!),
    isPointerLocked: () => isPointerLocked(inputContext!),
    lateUpdate: () => {},
  };

  const actionMap: ActionMapConfig = {
    move_vertical: { type: "axis", positiveKey: "KeyW", negativeKey: "KeyS" },
    move_horizontal: { type: "axis", positiveKey: "KeyD", negativeKey: "KeyA" },
    move_y_axis: {
      type: "axis",
      positiveKey: "Space",
      negativeKey: "ShiftLeft",
    },
  };

  actionController = {
    isPressed: (name: string) => isActionPressed(actionMap, inputReader, name),
    getAxis: (name: string) => getAxisValue(actionMap, inputReader, name),
    getMouseDelta: () => inputReader.getMouseDelta(),
    isPointerLocked: () => inputReader.isPointerLocked(),
  };

  cameraControllerSystem = new CameraControllerSystem(actionController);

  resourceManager = new ResourceManager(renderer);
  world = new World();
  sceneRenderData = new SceneRenderData();

  // Camera
  cameraEntity = world.createEntity();
  const camXform = new TransformComponent();
  camXform.setPosition(0, 1, 3);
  world.addComponent(cameraEntity, camXform);
  world.addComponent(cameraEntity, new CameraComponent(74, 16 / 9, 0.1, 100.0));
  world.addComponent(cameraEntity, new MainCameraTagComponent());

  // Lights (and scene lighting resource)
  world.addResource(new SceneLightingComponent());
  const sceneLighting = world.getResource(SceneLightingComponent)!;
  sceneLighting.fogColor.set([0.6, 0.7, 0.8, 1.0]);
  sceneLighting.fogParams0.set([0.2, 0.0, 0.1, 1.0]);

  const lightMaterial1 = await resourceManager.createPBRMaterial({
    albedo: [1, 0, 0, 1],
    emissive: [1, 0, 0],
  });
  const lightMaterial2 = await resourceManager.createPBRMaterial({
    albedo: [0, 1, 0, 1],
    emissive: [0, 1, 0],
  });
  const sphereMesh = resourceManager.createMesh(
    "sphere",
    createIcosphereMeshData(0.1),
  );

  light1Entity = world.createEntity();
  world.addComponent(light1Entity, new TransformComponent());
  world.addComponent(light1Entity, new LightComponent([1, 0, 0, 1]));
  world.addComponent(
    light1Entity,
    new MeshRendererComponent(sphereMesh, lightMaterial1),
  );

  light2Entity = world.createEntity();
  world.addComponent(light2Entity, new TransformComponent());
  world.addComponent(light2Entity, new LightComponent([0, 1, 0, 1]));
  world.addComponent(
    light2Entity,
    new MeshRendererComponent(sphereMesh, lightMaterial2),
  );

  // Create multiple materials for variety
  const materials = await Promise.all([
    // Metallic materials
    resourceManager.createPBRMaterial({
      albedo: [0.8, 0.6, 0.2, 1.0], // Gold-ish
      metallic: 0.9,
      roughness: 0.1,
    }),
    resourceManager.createPBRMaterial({
      albedo: [0.7, 0.7, 0.8, 1.0], // Steel-ish
      metallic: 1.0,
      roughness: 0.3,
    }),
    // Dielectric materials
    resourceManager.createPBRMaterial({
      albedo: [0.8, 0.2, 0.2, 1.0], // Red plastic
      metallic: 0.0,
      roughness: 0.7,
    }),
    resourceManager.createPBRMaterial({
      albedo: [0.2, 0.8, 0.3, 1.0], // Green plastic
      metallic: 0.0,
      roughness: 0.4,
    }),
    resourceManager.createPBRMaterial({
      albedo: [0.1, 0.1, 0.8, 1.0], // Blue ceramic
      metallic: 0.0,
      roughness: 0.1,
    }),
  ]);

  const cubeMesh = resourceManager.createMesh("cube", createCubeMeshData());

  // Spawn 1000 cubes with randomized transforms and materials
  const NUM_CUBES = 1000;
  for (let i = 0; i < NUM_CUBES; i++) {
    const cubeEntity = world.createEntity();
    const cubeXform = new TransformComponent();

    // Random position
    const px = (Math.random() - 0.5) * 50;
    const py = (Math.random() - 0.5) * 50;
    const pz = (Math.random() - 0.5) * 50;
    cubeXform.setPosition(px, py, pz);

    // Random rotation
    const rx = Math.random() * Math.PI * 2;
    const ry = Math.random() * Math.PI * 2;
    const rz = Math.random() * Math.PI * 2;
    const q = quat.fromEuler(rx, ry, rz, "xyz");
    cubeXform.setRotation(q);

    // Random scale
    const s = 0.5 + Math.random() * 1.5;
    cubeXform.setScale(s, s, s);

    // Pick random material
    const randomMaterial =
      materials[Math.floor(Math.random() * materials.length)];

    world.addComponent(cubeEntity, cubeXform);
    world.addComponent(
      cubeEntity,
      new MeshRendererComponent(cubeMesh, randomMaterial),
    );
  }

  (self as any).postMessage({ type: "READY" });
}

function frame(now: number) {
  if (!renderer || !world || !sceneRenderData || !cameraControllerSystem)
    return;

  // dt in seconds; clamp long pauses
  const MAX_PAUSE = 0.5;
  let dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 0;
  lastFrameTime = now;
  if (dt > MAX_PAUSE) dt = MAX_PAUSE;

  // Input-driven camera
  cameraControllerSystem.update(world, dt);

  // Animate lights
  const t = now / 1000;
  const radius = 3.0;
  const l1 = world.getComponent(light1Entity, TransformComponent)!;
  l1.setPosition(Math.sin(t * 0.7) * radius, 2.0, Math.cos(t * 0.7) * radius);
  const l2 = world.getComponent(light2Entity, TransformComponent)!;
  l2.setPosition(Math.sin(-t * 0.4) * radius, 2.0, Math.cos(-t * 0.4) * radius);

  // Core systems
  transformSystem(world);
  cameraSystem(world);

  // Render
  renderSystem(world, renderer, sceneRenderData);

  // Publish per-frame metrics
  if (metricsContext && renderer) {
    publishMetrics(metricsContext, renderer.getStats(), dt, ++metricsFrameId);
  }

  // Acknowledge frame completion to main thread
  (self as any).postMessage({ type: "FRAME_DONE" });
}

self.onmessage = async (ev: MessageEvent<InitMsg | ResizeMsg | FrameMsg>) => {
  const msg = ev.data;

  if (msg.type === MSG_INIT) {
    await initWorker(
      msg.canvas,
      msg.sharedInputBuffer,
      msg.sharedMetricsBuffer,
    );
    return;
  }

  // If not yet initialized, ignore most messages but ACK FRAME to prevent main from stalling
  if (!renderer || !world) {
    if (msg.type === MSG_FRAME) {
      (self as any).postMessage({ type: "FRAME_DONE" });
    }
    return;
  }

  switch (msg.type) {
    case MSG_RESIZE: {
      const cam = world.getComponent(cameraEntity, CameraComponent)!;
      renderer.requestResize(
        msg.cssWidth,
        msg.cssHeight,
        msg.devicePixelRatio,
        cam,
      );
      break;
    }
    case MSG_FRAME: {
      frame(msg.now);
      break;
    }
  }
};

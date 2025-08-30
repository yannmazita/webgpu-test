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
import { createCubeMeshData } from "@/core/utils/primitives";
import { ActionManager, ActionMapConfig } from "@/core/actionManager";
import { RemoteInputSource } from "@/core/remoteInputSource";
import { CameraControllerSystem } from "@/core/ecs/systems/cameraControllerSystem";

// Message constants
const MSG_INIT = "INIT";
const MSG_RESIZE = "RESIZE";
const MSG_INPUT = "INPUT";
const MSG_FRAME = "FRAME";

interface InitMsg {
  type: typeof MSG_INIT;
  canvas: OffscreenCanvas;
}
interface ResizeMsg {
  type: typeof MSG_RESIZE;
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
}
interface InputMsg {
  type: typeof MSG_INPUT;
  keys: string[];
  mouseDeltaX: number;
  mouseDeltaY: number;
  isPointerLocked: boolean;
}
interface FrameMsg {
  type: typeof MSG_FRAME;
  now: number;
  // bundled input (optional)
  keys?: string[];
  mouseDeltaX?: number;
  mouseDeltaY?: number;
  isPointerLocked?: boolean;
}

let renderer: Renderer | null = null;
let resourceManager: ResourceManager | null = null;
let world: World | null = null;
let sceneRenderData: SceneRenderData | null = null;

let cameraEntity = -1;
let light1Entity = -1;
let light2Entity = -1;

const inputSource = new RemoteInputSource();
const actionMap: ActionMapConfig = {
  move_vertical: { type: "axis", positiveKey: "KeyW", negativeKey: "KeyS" },
  move_horizontal: { type: "axis", positiveKey: "KeyD", negativeKey: "KeyA" },
  move_y_axis: { type: "axis", positiveKey: "Space", negativeKey: "ShiftLeft" },
};
const actionManager = new ActionManager(
  // Structural typing: RemoteInputSource is compatible
  inputSource as any,
  actionMap,
);
const cameraControllerSystem = new CameraControllerSystem(actionManager);

// State for dt
let lastFrameTime = 0;

async function initWorker(offscreen: OffscreenCanvas) {
  renderer = new Renderer(offscreen);
  await renderer.init();

  resourceManager = new ResourceManager(renderer);
  world = new World();
  sceneRenderData = new SceneRenderData();

  // Camera
  cameraEntity = world.createEntity();
  const camXform = new TransformComponent();
  camXform.setPosition(0, 1, 3);
  world.addComponent(cameraEntity, camXform);
  world.addComponent(cameraEntity, new CameraComponent(90, 16 / 9, 0.1, 100.0));
  world.addComponent(cameraEntity, new MainCameraTagComponent());

  // Lights (and scene lighting resource)
  world.addResource(new SceneLightingComponent());

  light1Entity = world.createEntity();
  world.addComponent(light1Entity, new TransformComponent());
  world.addComponent(light1Entity, new LightComponent([1, 0, 0, 1]));

  light2Entity = world.createEntity();
  world.addComponent(light2Entity, new TransformComponent());
  world.addComponent(light2Entity, new LightComponent([0, 1, 0, 1]));

  // One cube
  const material1 = await resourceManager.createPhongMaterial({
    baseColor: [1, 0.5, 0.2, 1.0],
    specularColor: [1.0, 1.0, 1.0],
    shininess: 100.0,
  });
  const cubeMesh = resourceManager.createMesh("cube", createCubeMeshData());
  const cubeEntity = world.createEntity();
  world.addComponent(cubeEntity, new TransformComponent());
  world.addComponent(
    cubeEntity,
    new MeshRendererComponent(cubeMesh, material1),
  );

  (self as any).postMessage({ type: "READY" });
}

function frame(now: number) {
  if (!renderer || !world || !sceneRenderData) return;

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
  const cam = world.getComponent(cameraEntity, CameraComponent)!;
  renderSystem(world, renderer, sceneRenderData);

  // Reset input for next frame (main also resets, but safe to clear here)
  inputSource.lateUpdate();

  // Acknowledge frame completion to main thread
  (self as any).postMessage({ type: "FRAME_DONE" });
}

self.onmessage = async (
  ev: MessageEvent<InitMsg | ResizeMsg | InputMsg | FrameMsg>,
) => {
  const msg = ev.data;

  if (msg.type === MSG_INIT) {
    await initWorker(msg.canvas);
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
    case MSG_INPUT: {
      inputSource.applyInput(
        msg.keys,
        msg.mouseDeltaX,
        msg.mouseDeltaY,
        msg.isPointerLocked,
      );
      break;
    }
    case MSG_FRAME: {
      // Apply bundled input if present
      if (
        typeof msg.mouseDeltaX === "number" &&
        typeof msg.mouseDeltaY === "number" &&
        Array.isArray(msg.keys)
      ) {
        inputSource.applyInput(
          msg.keys,
          msg.mouseDeltaX!,
          msg.mouseDeltaY!,
          !!msg.isPointerLocked,
        );
      }
      frame(msg.now);
      break;
    }
  }
};

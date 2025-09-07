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
  createPlaneMeshData,
} from "@/core/utils/primitives";
import { CameraControllerSystem } from "@/core/ecs/systems/cameraControllerSystem";
import { quat, vec3 } from "wgpu-matrix";
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
  ActionStateMap,
  getAxisValue,
  IActionController,
  isActionPressed,
  wasActionPressed,
} from "@/core/action";
import { PRNG } from "@/core/utils/prng";
import { setParent } from "@/core/ecs/utils/hierarchy";
import { SkyboxComponent } from "@/core/ecs/components/skyboxComponent";

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
let gridRootEntity = -1;
let light1Entity = -1;
let light2Entity = -1;
let light3Entity = -1;
let light4Entity = -1;

let inputContext: InputContext | null = null;
let actionController: IActionController | null = null;
let cameraControllerSystem: CameraControllerSystem | null = null;
let isFreeCameraActive = false;
const previousActionState: ActionStateMap = new Map();

let metricsContext: MetricsContext | null = null;
let metricsFrameId = 0;

// State for dt
let lastFrameTime = 0;
let animationStartTime = 0;

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
    toggle_camera_mode: { type: "button", keys: ["KeyC"] },
  };

  actionController = {
    isPressed: (name: string) => isActionPressed(actionMap, inputReader, name),
    wasPressed: (name: string) =>
      wasActionPressed(actionMap, inputReader, name, previousActionState),
    getAxis: (name: string) => getAxisValue(actionMap, inputReader, name),
    getMouseDelta: () => inputReader.getMouseDelta(),
    isPointerLocked: () => inputReader.isPointerLocked(),
  };

  cameraControllerSystem = new CameraControllerSystem(actionController);

  resourceManager = new ResourceManager(renderer);
  world = new World();
  sceneRenderData = new SceneRenderData();

  // --- Scene Setup ---

  // Environment Map & IBL
  const envMap = await resourceManager.createEnvironmentMap(
    "/assets/hdris/qwantani_night_puresky_4k.hdr",
    1024,
  );
  world.addResource(new SkyboxComponent(envMap.skyboxMaterial));
  world.addResource(envMap.iblComponent);

  // Camera
  cameraEntity = world.createEntity();
  const cameraTransform = new TransformComponent();
  // Start above pillars at origin;
  cameraTransform.setPosition(0, 52, 0);
  world.addComponent(cameraEntity, cameraTransform);
  world.addComponent(
    cameraEntity,
    new CameraComponent(74, 16 / 9, 0.1, 1000.0),
  );
  world.addComponent(cameraEntity, new MainCameraTagComponent());

  const q = quat.identity();
  // Rotate -90 degrees around X so default forward (-Z) becomes -Y
  quat.rotateX(q, -Math.PI / 2, q);
  quat.rotateZ(q, -Math.PI / 24, q);
  cameraTransform.setRotation(q);

  // Scene Lighting and Fog
  world.addResource(new SceneLightingComponent());
  const sceneLighting = world.getResource(SceneLightingComponent)!;
  sceneLighting.ambientColor.set([0.3, 0.32, 0.46, 1.0]);
  sceneLighting.fogColor.set([0.196, 0.211, 0.254, 1.0]); // #323641
  sceneLighting.fogParams0.set([0.03, 0.0, 0.0, 1.0]);

  // Ground Plane
  const groundPlaneEntity = world.createEntity();
  const groundMaterial = await resourceManager.createUnlitGroundMaterial({
    color: [0.01, 0.01, 0.02, 1.0],
  });
  const groundMesh = resourceManager.createMesh(
    "ground_plane",
    createPlaneMeshData(500),
  );
  const groundXform = new TransformComponent();
  groundXform.setPosition(0, 0, 0);
  world.addComponent(groundPlaneEntity, groundXform);
  world.addComponent(
    groundPlaneEntity,
    new MeshRendererComponent(groundMesh, groundMaterial),
  );

  // Lights
  const lightMaterialRed = await resourceManager.createPBRMaterial({
    albedo: [1, 0, 0, 1],
    emissive: [1, 0, 0],
  });
  const lightMaterialGreen = await resourceManager.createPBRMaterial({
    albedo: [0, 1, 0, 1],
    emissive: [0, 1, 0],
  });
  const lightMaterialBlue = await resourceManager.createPBRMaterial({
    albedo: [0, 0, 1, 1],
    emissive: [0, 0, 1],
  });
  const lightMaterialPurple = await resourceManager.createPBRMaterial({
    albedo: [0.5, 0, 1, 1],
    emissive: [0.5, 0, 1],
  });
  const sphereMesh = resourceManager.createMesh(
    "sphere",
    createIcosphereMeshData(0.1),
  );

  light1Entity = world.createEntity();
  world.addComponent(light1Entity, new TransformComponent());
  world.addComponent(
    light1Entity,
    new LightComponent([1, 0, 0, 1], [0, 0, 0, 1], 20.0, 5.0),
  );
  world.addComponent(
    light1Entity,
    new MeshRendererComponent(sphereMesh, lightMaterialRed),
  );

  light2Entity = world.createEntity();
  world.addComponent(light2Entity, new TransformComponent());
  world.addComponent(
    light2Entity,
    new LightComponent([0, 1, 0, 1], [0, 0, 0, 1], 20.0, 5.0),
  );
  world.addComponent(
    light2Entity,
    new MeshRendererComponent(sphereMesh, lightMaterialGreen),
  );

  light3Entity = world.createEntity();
  world.addComponent(light3Entity, new TransformComponent());
  world.addComponent(
    light3Entity,
    new LightComponent([0, 0, 1, 1], [0, 0, 0, 1], 20.0, 5.0),
  );
  world.addComponent(
    light3Entity,
    new MeshRendererComponent(sphereMesh, lightMaterialBlue),
  );

  light4Entity = world.createEntity();
  world.addComponent(light4Entity, new TransformComponent());
  world.addComponent(
    light4Entity,
    new LightComponent([0.5, 0, 1, 1], [0, 0, 0, 1], 20.0, 5.0),
  );
  world.addComponent(
    light4Entity,
    new MeshRendererComponent(sphereMesh, lightMaterialPurple),
  );

  // Pillar Grid
  const GRID_W = 14;
  const GRID_H = 9;
  const PILLAR_BASE_SIZE = 2.0;
  const PILLAR_SPACING = 2.2;
  const PILLAR_HEIGHT = 40.0;

  const hiddenIndices = new Set([41, 40, 47, 48, 46, 95, 94, 102, 101]);
  const prng = new PRNG(1337);
  const cubeMesh = resourceManager.createMesh("cube", createCubeMeshData());

  gridRootEntity = world.createEntity();
  world.addComponent(gridRootEntity, new TransformComponent());

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const index = gy * GRID_W + gx + 1;
      if (hiddenIndices.has(index)) {
        continue;
      }

      const pillar = world.createEntity();
      const pillarXform = new TransformComponent();

      // Grid positions on XZ plane
      const px = (gx - GRID_W / 2 + 0.5) * PILLAR_SPACING;
      const pz = (gy - GRID_H / 2 + 0.5) * PILLAR_SPACING;

      // Lift pillar so its base sits on ground (y = 0)
      const py = PILLAR_HEIGHT / 2;

      pillarXform.setPosition(px, py, pz);

      pillarXform.setScale(
        PILLAR_BASE_SIZE * 0.8,
        PILLAR_HEIGHT,
        PILLAR_BASE_SIZE * 0.8,
      );

      const grey = 0.38 + prng.next() * 0.3;
      const material = await resourceManager.createPBRMaterial({
        albedo: [grey, grey + 0.05, grey + 0.15, 1],
        metallic: 0.0,
        roughness: 0.8 + prng.next() * 0.1, // varied roughness
      });

      world.addComponent(pillar, pillarXform);
      world.addComponent(pillar, new MeshRendererComponent(cubeMesh, material));
      setParent(world, pillar, gridRootEntity);
    }
  }

  (self as any).postMessage({ type: "READY" });
}

// PS2 "long" startup demo
function frame(now: number) {
  if (
    !renderer ||
    !world ||
    !sceneRenderData ||
    !cameraControllerSystem ||
    !actionController
  )
    return;

  const MAX_PAUSE = 0.5;
  let dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 0;
  lastFrameTime = now;
  if (dt > MAX_PAUSE) dt = MAX_PAUSE;

  if (actionController.wasPressed("toggle_camera_mode")) {
    isFreeCameraActive = !isFreeCameraActive;
    // When switching TO free camera, sync its state from the animation
    if (isFreeCameraActive) {
      const cameraTransform = world.getComponent(
        cameraEntity,
        TransformComponent,
      )!;
      cameraControllerSystem.syncFromTransform(cameraTransform);
    }
  }

  const cameraTransform = world.getComponent(cameraEntity, TransformComponent)!;

  if (isFreeCameraActive) {
    cameraControllerSystem.update(world, dt);
  } else {
    // Initialize animation timer on first frame
    if (animationStartTime === 0) animationStartTime = now;

    const DURATION_MS = 12000;
    const elapsed = (now - animationStartTime) % DURATION_MS;
    const t = elapsed / DURATION_MS; // normalized [0,1), loops every 12s

    let easedVerticalProgress: number;
    let easedRollProgress: number;
    if (t <= 10 / 12) {
      // First 10 seconds
      const localT = t / (10 / 12);
      easedVerticalProgress = Math.pow(localT, 3.5);
      easedVerticalProgress *= 10 / 12; // scale back into [0,0.833]

      easedRollProgress = Math.pow(localT, 3.2);
      easedRollProgress *= 10 / 12;
    } else {
      // Last 2 seconds
      const localT = (t - 10 / 12) / (2 / 12);
      easedVerticalProgress = 1.0 - Math.pow(1 - localT, 2); // fast ease-out
      easedVerticalProgress = 10 / 12 + easedVerticalProgress * (2 / 12); // scale into [0.833,1]

      easedRollProgress = 1.0 - Math.pow(1 - localT, 5);
      easedRollProgress = 10 / 12 + easedRollProgress * (2 / 12);
    }

    // Vertical drop
    const START_Y = 52.0; // Same as initial Y position, important
    const END_Y = 40.0;
    const currentY = START_Y + (END_Y - START_Y) * easedVerticalProgress;
    cameraTransform.setPosition(0, currentY, 0);

    // Z-axis roll animation
    const START_ROT_Z_RAD = -Math.PI / 24; // Same as initial Z rotation, important
    const END_ROT_Z_RAD = Math.PI / 2;
    const currentRotZRad =
      START_ROT_Z_RAD + (END_ROT_Z_RAD - START_ROT_Z_RAD) * easedRollProgress;

    const finalRotation = quat.identity();
    quat.rotateX(finalRotation, -Math.PI / 2, finalRotation); // Apply the -90deg pitch to look down
    quat.rotateZ(finalRotation, currentRotZRad, finalRotation); // Apply the roll around new Z axis

    cameraTransform.setRotation(finalRotation);
  }

  // Animate lights
  const LIGHT_ANIM_DURATION_S = 8.0;
  const lightProgress =
    ((now / 1000) % LIGHT_ANIM_DURATION_S) / LIGHT_ANIM_DURATION_S;

  const l1Xform = world.getComponent(light1Entity, TransformComponent)!;
  const startPos1 = vec3.fromValues(10, 41, 10);
  const endPos1 = vec3.fromValues(-5, 42, -15);
  const currentPos1 = vec3.lerp(startPos1, endPos1, lightProgress);
  l1Xform.setPosition(currentPos1);

  const l2Xform = world.getComponent(light2Entity, TransformComponent)!;
  const startPos2 = vec3.fromValues(10, 41, 0);
  const endPos2 = vec3.fromValues(-15, 40.5, 5);
  const currentPos2 = vec3.lerp(startPos2, endPos2, lightProgress);
  l2Xform.setPosition(currentPos2);

  const l3Xform = world.getComponent(light3Entity, TransformComponent)!;
  const startPos3 = vec3.fromValues(-10, 40, 10);
  const endPos3 = vec3.fromValues(15, 42.5, -5);
  const currentPos3 = vec3.lerp(startPos3, endPos3, lightProgress);
  l3Xform.setPosition(currentPos3);

  const l4Xform = world.getComponent(light4Entity, TransformComponent)!;
  const startPos4 = vec3.fromValues(5, 42, -15);
  const endPos4 = vec3.fromValues(-10, 40, 15);
  const currentPos4 = vec3.lerp(startPos4, endPos4, lightProgress);
  l4Xform.setPosition(currentPos4);

  transformSystem(world);
  cameraSystem(world);

  renderSystem(world, renderer, sceneRenderData);

  if (metricsContext && renderer) {
    publishMetrics(metricsContext, renderer.getStats(), dt, ++metricsFrameId);
  }

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

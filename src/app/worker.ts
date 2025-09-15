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
import { createIcosphereMeshData } from "@/core/utils/primitives";
import { CameraControllerSystem } from "@/core/ecs/systems/cameraControllerSystem";
import { mat4, quat, vec3 } from "wgpu-matrix";
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
import { SkyboxComponent } from "@/core/ecs/components/skyboxComponent";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/sunComponent";
import { animationSystem } from "@/core/ecs/systems/animationSystem";

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
let demoModelEntity = -1;
let keyLightEntity = -1;
let fillLightEntity = -1;
let rimLightEntity = -1;

let inputContext: InputContext | null = null;
let actionController: IActionController | null = null;
let cameraControllerSystem: CameraControllerSystem | null = null;
let isFreeCameraActive = false;
const previousActionState: ActionStateMap = new Map();

let metricsContext: MetricsContext | null = null;
let metricsFrameId = 0;

// State for dt and camera orbit
let lastFrameTime = 0;
let animationStartTime = 0;
const orbitRadius = 3.0;
const orbitHeight = 1.0;

async function initWorker(
  offscreen: OffscreenCanvas,
  sharedInputBuffer: SharedArrayBuffer,
  sharedMetricsBuffer: SharedArrayBuffer,
) {
  console.log("[Worker] Initializing...");
  renderer = new Renderer(offscreen);
  console.log("[Worker] Awaiting renderer init...");
  await renderer.init();
  console.log("[Worker] Renderer initialized.");

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
  console.log("[Worker] Awaiting environment map...");
  const envMap = await resourceManager.createEnvironmentMap(
    "/assets/hdris/citrus_orchard_road_puresky_4k.hdr",
    1024,
  );
  console.log("[Worker] Environment map created.");
  world.addResource(new SkyboxComponent(envMap.skyboxMaterial));
  world.addResource(envMap.iblComponent);

  // Camera
  cameraEntity = world.createEntity();
  const cameraTransform = new TransformComponent();

  const initialX = orbitRadius;
  const initialY = orbitHeight;
  const initialZ = 0;

  // Camera position
  const eye = vec3.fromValues(initialX, initialY, initialZ);
  const target = vec3.fromValues(0, 0, 0);
  const up = vec3.fromValues(0, 1, 0);

  // Build lookAt (view matrix)
  const view = mat4.lookAt(eye, target, up);

  // Convert to world transform
  const worldFromView = mat4.invert(view);

  // Extract rotation
  const rotation = quat.fromMat(worldFromView);

  // Apply position + rotation
  cameraTransform.setPosition(initialX, initialY, initialZ);
  cameraTransform.setRotation(rotation);

  world.addComponent(cameraEntity, cameraTransform);
  world.addComponent(cameraEntity, new CameraComponent(45, 16 / 9, 0.1, 100.0));
  world.addComponent(cameraEntity, new MainCameraTagComponent());

  // Scene Lighting and Fog - Lighter fog to better see the demoModel
  //world.addResource(new SceneLightingComponent());
  //const sceneLighting = world.getResource(SceneLightingComponent)!;
  //sceneLighting.ambientColor.set([0.4, 0.42, 0.5, 1.0]);
  //sceneLighting.fogColor.set([0.8, 0.85, 0.9, 1.0]); // Light blue-gray
  //sceneLighting.fogParams0.set([0.01, 0.0, 0.0, 1.0]); // Very light fog

  /*
  // Ground Plane - Darker to contrast with demoModel
  const groundPlaneEntity = world.createEntity();
  const groundMaterial = await resourceManager.createUnlitGroundMaterial({
    color: [0.1, 0.1, 0.12, 1.0],
  });
  const groundMesh = await resourceManager.createMesh(
    "ground_plane",
    createPlaneMeshData(20),
  );
  const groundXform = new TransformComponent();
  groundXform.setPosition(0, -1.5, 0);
  world.addComponent(groundPlaneEntity, groundXform);
  world.addComponent(
    groundPlaneEntity,
    new MeshRendererComponent(groundMesh, groundMaterial),
  );
  */

  // Load the demo model
  try {
    console.log("[Worker] Awaiting GLTF scene load...");
    demoModelEntity = await resourceManager.loadSceneFromGLTF(
      world,
      //"/assets/models/gltf/khronos-samples/Box With Spaces/glTF/Box With Spaces.gltf",
      //"/assets/models/gltf/khronos-samples/AntiqueCamera.glb",
      //"/assets/models/gltf/khronos-samples/BoomBox.glb",
      //"/assets/models/gltf/khronos-samples/CompareNormal.glb",
      //"/assets/models/gltf/khronos-samples/CompareAmbientOcclusion.glb",
      "/assets/models/gltf/khronos-samples/AnimatedColorsCube.glb",
    );
    console.log("[Worker] GLTF scene loaded.");

    // Position and scale the demoModel appropriately
    const demoModelTransform = world.getComponent(
      demoModelEntity,
      TransformComponent,
    )!;
    demoModelTransform.setPosition(0, 0, 0);
    demoModelTransform.setScale(1, 1, 1);
  } catch (error) {
    console.error("Failed to load model:", error);
    // Fallback: create a simple sphere
    demoModelEntity = world.createEntity();
    const fallbackOptions = {
      albedo: [0.8, 0.6, 0.4, 1] as [number, number, number, number],
      metallic: 0.1,
      roughness: 0.3,
    };
    const fallbackTemplate =
      await resourceManager.createPBRMaterialTemplate(fallbackOptions);
    const fallbackInstance = await resourceManager.createPBRMaterialInstance(
      fallbackTemplate,
      fallbackOptions,
    );

    const sphereMesh = await resourceManager.createMesh(
      "fallback_sphere",
      createIcosphereMeshData(1.0, 3),
    );
    const demoModelTransform = new TransformComponent();
    demoModelTransform.setPosition(0, 0, 0);
    demoModelTransform.setScale(1, 1, 1);
    world.addComponent(demoModelEntity, demoModelTransform);
    world.addComponent(
      demoModelEntity,
      new MeshRendererComponent(sphereMesh, fallbackInstance),
    );
  }

  // Lighting setup for model - Three-point lighting
  const lightMeshWhite = await resourceManager.createMesh(
    "light_sphere",
    createIcosphereMeshData(0.05, 2),
  );

  const whiteOptions = {
    albedo: [1, 1, 1, 1] as [number, number, number, number],
    emissive: [1, 1, 1] as [number, number, number],
  };
  const whiteTemplate =
    await resourceManager.createPBRMaterialTemplate(whiteOptions);
  const lightMaterialWhite = await resourceManager.createPBRMaterialInstance(
    whiteTemplate,
    whiteOptions,
  );

  const warmOptions = {
    albedo: [1, 0.8, 0.6, 1] as [number, number, number, number],
    emissive: [1, 0.8, 0.6] as [number, number, number],
  };
  const warmTemplate =
    await resourceManager.createPBRMaterialTemplate(warmOptions);
  const lightMaterialWarm = await resourceManager.createPBRMaterialInstance(
    warmTemplate,
    warmOptions,
  );

  const coolOptions = {
    albedo: [0.6, 0.8, 1, 1] as [number, number, number, number],
    emissive: [0.6, 0.8, 1] as [number, number, number],
  };
  const coolTemplate =
    await resourceManager.createPBRMaterialTemplate(coolOptions);
  const lightMaterialCool = await resourceManager.createPBRMaterialInstance(
    coolTemplate,
    coolOptions,
  );

  // Key Light (main light)
  keyLightEntity = world.createEntity();
  const keyLightTransform = new TransformComponent();
  keyLightTransform.setPosition(2, 3, 2);
  world.addComponent(keyLightEntity, keyLightTransform);
  world.addComponent(
    keyLightEntity,
    new LightComponent([1, 0.95, 0.8, 1], [0, 0, 0, 1], 15.0, 8.0),
  );
  world.addComponent(
    keyLightEntity,
    new MeshRendererComponent(lightMeshWhite, lightMaterialWarm),
  );

  // Fill Light (softer, opposite side)
  fillLightEntity = world.createEntity();
  const fillLightTransform = new TransformComponent();
  fillLightTransform.setPosition(-1.5, 1, 1.5);
  world.addComponent(fillLightEntity, fillLightTransform);
  world.addComponent(
    fillLightEntity,
    new LightComponent([0.8, 0.9, 1, 1], [0, 0, 0, 1], 12.0, 3.0),
  );
  world.addComponent(
    fillLightEntity,
    new MeshRendererComponent(lightMeshWhite, lightMaterialCool),
  );

  // Rim Light (back light for edge definition)
  rimLightEntity = world.createEntity();
  const rimLightTransform = new TransformComponent();
  rimLightTransform.setPosition(0, 2, -3);
  world.addComponent(rimLightEntity, rimLightTransform);
  world.addComponent(
    rimLightEntity,
    new LightComponent([1, 1, 1, 1], [0, 0, 0, 1], 10.0, 4.0),
  );
  world.addComponent(
    rimLightEntity,
    new MeshRendererComponent(lightMeshWhite, lightMaterialWhite),
  );

  // Sun and shadows
  world.addResource(new SceneSunComponent());
  world.addResource(new ShadowSettingsComponent());

  (self as any).postMessage({ type: "READY" });
}

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
    // Free camera mode
    cameraControllerSystem.update(world, dt);
  } else {
    // Orbital camera animation around the model
    if (animationStartTime === 0) animationStartTime = now;

    const ORBIT_DURATION_MS = 20000; // 20 seconds for full orbit
    const elapsed = (now - animationStartTime) % ORBIT_DURATION_MS;
    const t = elapsed / ORBIT_DURATION_MS; // normalized [0,1)

    const angle = t * Math.PI * 2; // full 360 orbit
    const x = Math.cos(angle) * orbitRadius;
    const z = Math.sin(angle) * orbitRadius;
    const y = orbitHeight;

    // Camera position
    const eye = vec3.fromValues(x, y, z);
    const target = vec3.fromValues(0, 0, 0);
    const up = vec3.fromValues(0, 1, 0);

    // Build a lookAt *view* matrix
    const view = mat4.lookAt(eye, target, up);

    // Convert to world transform by inverting the view matrix
    const worldFromView = mat4.invert(view);

    // Extract orientation (upper 3×3) and convert to quaternion
    const rotation = quat.fromMat(worldFromView);

    // Apply position + rotation to the camera
    cameraTransform.setPosition(x, y, z);
    cameraTransform.setRotation(rotation);
  }

  /*
  // Rotate the model slowly
  if (demoModelEntity !== -1) {
    const demoModelTransform = world.getComponent(
      demoModelEntity,
      TransformComponent,
    );
    if (demoModelTransform) {
      const HELMET_ROTATION_SPEED = 0.3; // radians per second
      const rotationY = (now / 1000) * HELMET_ROTATION_SPEED;
      const rotation = quat.fromEuler(0, rotationY, 0, "xyz");
      demoModelTransform.setRotation(rotation);
    }
  }
  */

  // Drive animations (node-TRS) before recomputing world transforms
  animationSystem(world, dt);

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

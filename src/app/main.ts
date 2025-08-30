// src/app/main.ts
import { Renderer } from "@/core/renderer";
import "@/style.css";
import { vec3, Vec4, vec4 } from "wgpu-matrix";
import { ResourceManager } from "@/core/resourceManager";
import {
  init as initDebugUI,
  beginFrame as beginDebugUIFrame,
  render as renderDebugUI,
} from "@/core/debugUI";
import { ImGui } from "@mori2003/jsimgui";
import { InputManager } from "@/core/inputManager";
import { ActionManager, ActionMapConfig } from "@/core/actionManager";
import { getMouseWorldPosition } from "@/core/utils/raycast";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { World } from "@/core/ecs/world";
import { transformSystem } from "@/core/ecs/systems/transformSystem";
import {
  renderSystem,
  SceneLightingComponent,
} from "@/core/ecs/systems/renderSystem";
import { MeshRendererComponent } from "@/core/ecs/components/meshRendererComponent";
import { CameraControllerSystem } from "@/core/ecs/systems/cameraControllerSystem";
import { MainCameraTagComponent } from "@/core/ecs/components/tagComponents";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { LightComponent } from "@/core/ecs/components/lightComponent";
import { cameraSystem } from "@/core/ecs/systems/cameraSystem";
import { Profiler } from "@/core/utils/profiler";
import { createCubeMeshData } from "@/core/utils/primitives";
import { SceneRenderData } from "@/core/types/rendering";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) {
  throw new Error("Canvas element not found");
}

try {
  // Synchronize canvas bitmap size with its display size.
  // This must be done before the Renderer is initialized so that the
  // first depth texture it creates has the correct dimensions.
  const devicePixelRatio = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  const renderer = new Renderer(canvas);
  await renderer.init();

  await initDebugUI(canvas, renderer.device);

  const resourceManager = new ResourceManager(renderer);
  const world = new World();
  const sceneRenderData = new SceneRenderData();
  const inputManager = new InputManager(canvas);
  // Define the abstract actions and their default keyboard mappings
  // using KeyboardEvent.code values for layout independence (WASD on QWERTY is ZQSD on AZERTY)
  const actionMap: ActionMapConfig = {
    move_vertical: {
      type: "axis",
      positiveKey: "KeyW", // Forward
      negativeKey: "KeyS", // Backward
    },
    move_horizontal: {
      type: "axis",
      positiveKey: "KeyD", // Strafe Right
      negativeKey: "KeyA", // Strafe Left
    },
    move_y_axis: {
      type: "axis",
      positiveKey: "Space",
      negativeKey: "ShiftLeft",
    },
  };

  const actionManager = new ActionManager(inputManager, actionMap);
  const cameraControllerSystem = new CameraControllerSystem(actionManager);

  // Create the main camera entity
  const cameraEntity = world.createEntity();
  const cameraTransform = new TransformComponent();
  cameraTransform.setPosition(0, 1, 3);
  world.addComponent(cameraEntity, cameraTransform);
  world.addComponent(
    cameraEntity,
    new CameraComponent(90, canvas.width / canvas.height, 0.1, 100.0),
  );
  world.addComponent(cameraEntity, new MainCameraTagComponent());

  // Create Scene Lighting Resource & Light Entities
  const sceneLighting = new SceneLightingComponent();
  world.addResource(sceneLighting);

  const light1Entity = world.createEntity();
  const light1Comp = new LightComponent([1, 0, 0, 1]);
  world.addComponent(light1Entity, new TransformComponent());
  world.addComponent(light1Entity, light1Comp);

  const light2Entity = world.createEntity();
  const light2Comp = new LightComponent([0, 1, 0, 1]);
  world.addComponent(light2Entity, new TransformComponent());
  world.addComponent(light2Entity, light2Comp);

  // ImGui state
  const ambientColorUI = [0.1, 0.1, 0.1];
  const light1ColorUI = [1.0, 0.0, 0.0, 1.0];
  const light2ColorUI = [0.0, 1.0, 0.0, 1.0];

  /*
  // Create Material and Mesh
  const [material1, teapotMesh] = await Promise.all([
    resourceManager.createPhongMaterial({
      baseColor: [1, 1, 1, 1.0], // White
      specularColor: [0.1, 0.1, 0.1], // White highlights
      shininess: 50.0,
    }),
    resourceManager.loadMeshFromOBJ("/assets/models/teapot.obj"),
  ]);

  // Create teapot entity
  const teapotScale = vec3.fromValues(0.07, 0.07, 0.07);
  const teapotEntity = world.createEntity();
  const teapotTransform = new TransformComponent();
  teapotTransform.setScale(teapotScale);
  world.addComponent(teapotEntity, teapotTransform);
  world.addComponent(
    teapotEntity,
    new MeshRendererComponent(teapotMesh, material1),
  );
  */

  // Create Material and Mesh
  const material1 = await resourceManager.createPhongMaterial({
    baseColor: [1, 0.5, 0.2, 1.0], // Orange
    specularColor: [1.0, 1.0, 1.0],
    shininess: 100.0,
  });

  const cubeMesh = resourceManager.createMesh("cube", createCubeMeshData());

  // Create cube entity
  const cubeEntity = world.createEntity();
  const cubeTransform = new TransformComponent();
  // cubeTransform.setScale(vec3.fromValues(0.5, 0.5, 0.5)); // Optional scale
  world.addComponent(cubeEntity, cubeTransform);
  world.addComponent(
    cubeEntity,
    new MeshRendererComponent(cubeMesh, material1), // Use cubeMesh here
  );

  // Animation Loop
  let lastFrameTime = performance.now();
  let fps = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;
  const FPS_UPDATE_INTERVAL = 0.25; // seconds (smooths the display)
  const MAX_PAUSE = 0.5; // clamp crazy dt after tab switches
  let frameCounter = 0; // For profiler logging

  const animate = (now: number) => {
    frameCounter++;
    Profiler.begin("Frame");

    let deltaTime = (now - lastFrameTime) / 1000; // time in seconds
    lastFrameTime = now;

    // clamp giant delta time when tab is backgrounded so it doesn't tank fps display
    if (deltaTime > MAX_PAUSE) deltaTime = MAX_PAUSE;

    // --- INPUT & LOGIC SYSTEMS ---
    Profiler.begin("Input");
    // Update camera based on input
    cameraControllerSystem.update(world, deltaTime);
    Profiler.end("Input");

    // --- TEMPORARILY DISABLE IMGUI TO TEST PERFORMANCE ---
    const IMGUI_ENABLED = false;

    if (IMGUI_ENABLED) {
      Profiler.begin("ImGui.Begin");
      beginDebugUIFrame(canvas);
      Profiler.end("ImGui.Begin");
    }

    // update smoothed FPS
    fpsAccum += deltaTime;
    fpsFrames++;
    if (fpsAccum >= FPS_UPDATE_INTERVAL) {
      fps = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
      if (Profiler.isEnabled()) {
        console.log(`FPS: ${fps.toFixed(1)}`);
      }
    }

    // --- UI & DEBUG (ALL DISABLED) ---
    if (IMGUI_ENABLED) {
      Profiler.begin("ImGui.Draw");
      // Calculate world position from mouse
      let worldPosStr = "N/A (off-canvas)";
      const mousePos = inputManager.mousePosition;
      if (mousePos.x >= 0 && mousePos.y >= 0) {
        const camComp = world.getComponent(cameraEntity, CameraComponent)!;
        const camTrans = world.getComponent(cameraEntity, TransformComponent)!;
        const worldPos = getMouseWorldPosition(
          mousePos,
          canvas,
          camComp,
          camTrans,
        );
        if (worldPos) {
          worldPosStr = `(${worldPos[0].toFixed(2)}, ${worldPos[1].toFixed(
            2,
          )}, ${worldPos[2].toFixed(2)})`;
        } else {
          worldPosStr = "N/A (no intersection)";
        }
      }

      ImGui.Begin("Debug Controls");
      ImGui.Text(
        `FPS: ${fps.toFixed(1)}  (${(fps > 0 ? 1000 / fps : 0).toFixed(1)} ms)`,
      );
      ImGui.Separator();
      ImGui.Text(`Mouse Screen: (${mousePos.x}, ${mousePos.y})`);
      ImGui.Text(`Mouse World (on Y=0 plane): ${worldPosStr}`);
      ImGui.Separator();
      ImGui.Text("Camera Controls: Click canvas to lock pointer.");
      ImGui.Text("Movement: ZQSD/WASD");
      ImGui.Text("Space: Up, Left Shift: Down");
      ImGui.Text("Light Controls");
      ImGui.Separator();
      ImGui.Text("Key Debug:");
      const pressedKeys = Array.from(inputManager.keys).join(", ");
      ImGui.Text(`Pressed Keys: ${pressedKeys || "None"}`);
      ImGui.Separator();

      if (ImGui.ColorEdit3("Ambient Color", ambientColorUI)) {
        vec4.set(
          ambientColorUI[0],
          ambientColorUI[1],
          ambientColorUI[2],
          1.0,
          sceneLighting.ambientColor,
        );
      }
      if (ImGui.ColorEdit4("Light 1 Color", light1ColorUI)) {
        vec4.copy(light1ColorUI as Vec4, light1Comp.light.color);
      }
      if (ImGui.ColorEdit4("Light 2 Color", light2ColorUI)) {
        vec4.copy(light2ColorUI as Vec4, light2Comp.light.color);
      }
      ImGui.End();
      Profiler.end("ImGui.Draw");
    }

    // Animate the lights in circles by updating their transforms
    Profiler.begin("LightAnimation");
    const time = now / 1000; // time in seconds
    const radius = 3.0;
    const light1Transform = world.getComponent(
      light1Entity,
      TransformComponent,
    )!;
    light1Transform.setPosition(
      Math.sin(time * 0.7) * radius,
      2.0,
      Math.cos(time * 0.7) * radius,
    );
    const light2Transform = world.getComponent(
      light2Entity,
      TransformComponent,
    )!;
    light2Transform.setPosition(
      Math.sin(-time * 0.4) * radius,
      2.0,
      Math.cos(-time * 0.4) * radius,
    );
    Profiler.end("LightAnimation");

    // --- CORE LOGIC & RENDER SYSTEMS ---
    Profiler.begin("TransformSystem");
    transformSystem(world);
    Profiler.end("TransformSystem");

    Profiler.begin("CameraSystem");
    cameraSystem(world);
    Profiler.end("CameraSystem");

    Profiler.begin("RenderSystem");
    renderSystem(
      world,
      renderer,
      sceneRenderData,
      IMGUI_ENABLED ? renderDebugUI : undefined,
    );
    Profiler.end("RenderSystem");

    // --- FRAME END ---
    Profiler.begin("InputLateUpdate");
    inputManager.lateUpdate(); // Reset input deltas for the next frame
    Profiler.end("InputLateUpdate");

    Profiler.end("Frame");

    // Log profiling report every 60 frames (roughly 1 second)
    if (frameCounter % 60 === 0) {
      Profiler.logReport();
    }

    requestAnimationFrame(animate);
  };

  requestAnimationFrame(animate);
} catch (error) {
  console.error(error);

  const appContainer = document.querySelector<HTMLDivElement>("#app");
  if (!appContainer) {
    console.error("Fatal: #app container not found in DOM.");
  }

  const errorContainer = document.createElement("div");
  errorContainer.className = "error";

  const header = document.createElement("h2");
  header.textContent = "Error Initializing WebGPU";

  const message = document.createElement("p");
  message.textContent =
    "Could not initialize the graphics engine. Please ensure you are using a modern browser that supports WebGPU.";

  const details = document.createElement("pre");
  details.textContent = (error as Error).message;

  errorContainer.appendChild(header);
  errorContainer.appendChild(message);
  errorContainer.appendChild(details);

  appContainer.replaceChildren(errorContainer);
}

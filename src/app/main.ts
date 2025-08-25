// src/app/main.ts
import { Renderer } from "@/core/renderer";
import "@/style.css";
import { vec3, vec4 } from "wgpu-matrix";
import { Camera } from "@/core/camera";
import { ResourceManager } from "@/core/resourceManager";
import { Scene } from "@/core/scene";
import { Light } from "@/core/types/gpu";
import {
  init as initDebugUI,
  beginFrame as beginDebugUIFrame,
  render as renderDebugUI,
} from "@/core/debugUI";
import { ImGui } from "@mori2003/jsimgui";
import { SceneNode } from "@/core/sceneNode";
import { InputManager } from "@/core/inputManager";
import { CameraController } from "@/core/cameraController";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) {
  throw new Error("Canvas element not found");
}

try {
  // Synchronize canvas bitmap size with its display size.
  // This must be done before the Renderer is initialized so that the
  // first depth texture it creates has the correct dimensions.
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  const renderer = new Renderer(canvas);
  await renderer.init();

  await initDebugUI(canvas, renderer.device);

  const resourceManager = new ResourceManager(renderer);
  const scene = new Scene();
  const camera = new Camera();
  const inputManager = new InputManager(canvas);
  const cameraController = new CameraController(camera, inputManager);

  // Configure camera projection
  camera.setPerspective(
    (90 * Math.PI) / 180, // 90 degrees field of view
    canvas.width / canvas.height,
    0.1,
    100.0,
  );

  // Position the camera to look at the scene
  camera.lookAt(
    vec3.fromValues(0, 1, 1),
    vec3.fromValues(0, 0, 0),
    vec3.fromValues(0, 0, 1), // utah_vw_beetle.stl is exported with z-up
    //vec3.fromValues(0, 1, 0), // Standard y-up
  );

  // Create Scene Lights
  // light positions will be set in animate loop
  const light1: Light = {
    position: vec4.create(),
    color: vec4.fromValues(1, 0, 0, 1), // Red light
  };
  scene.lights.push(light1);

  const light2: Light = {
    position: vec4.create(),
    color: vec4.fromValues(0, 1, 0, 1), // Green light
  };
  scene.lights.push(light2);

  // ImGui needs plain arrays that it can modify directly
  const ambientColorUI = [0.1, 0.1, 0.1];
  const light1ColorUI = [1.0, 0.0, 0.0, 1.0]; // Red
  const light2ColorUI = [0.0, 1.0, 0.0, 1.0]; // Green

  // Create Material and Mesh
  const [material1, material2, material3, teapotMesh] = await Promise.all([
    resourceManager.createPhongMaterial({
      baseColor: [1, 1, 1, 1.0], // White
      specularColor: [0.1, 0.1, 0.1], // White highlights
      shininess: 50.0,
    }),
    resourceManager.createPhongMaterial({
      baseColor: [1, 1, 1, 2 / 3], // White, semi transparent
      specularColor: [0.1, 0.1, 0.1], // White highlights
      shininess: 50.0,
    }),
    resourceManager.createPhongMaterial({
      baseColor: [1, 1, 1, 1 / 3], // White, very transparent
      specularColor: [0.1, 0.1, 0.1], // White highlights
      shininess: 50.0,
    }),
    //resourceManager.loadMeshFromOBJ("/assets/models/beetle.obj"),
    //resourceManager.loadMeshFromSTL("/assets/models/utah_vw_bug.stl"),
    resourceManager.loadMeshFromSTL("/assets/models/utah_teapot.stl"),
  ]);

  // Create renderable objects and add them to the scene
  const teapotScale = vec3.fromValues(0.07, 0.07, 0.07);

  // Teapot 1 (Parent, Opaque)
  const teapotNode1 = new SceneNode();
  teapotNode1.mesh = teapotMesh;
  teapotNode1.material = material1;
  teapotNode1.setScale(teapotScale);
  scene.add(teapotNode1); // Add node to the scene root

  // Teapot 2 (Child, Semi-Transparent)
  const teapotNode2 = new SceneNode();
  teapotNode2.mesh = teapotMesh;
  teapotNode2.material = material2;
  teapotNode2.setPosition(0, 0, 1); // Position is local to the parent
  teapotNode1.addChild(teapotNode2); // Add as a child of teapot 1

  // Teapot 3 (Grandchild, Very Transparent)
  const teapotNode3 = new SceneNode();
  teapotNode3.mesh = teapotMesh;
  teapotNode3.material = material3;
  teapotNode3.setPosition(0, 0, 1); // Position is local to its parent (teapot 2)
  teapotNode2.addChild(teapotNode3); // Add as a child of teapot 2

  // Animation Loop
  let lastFrameTime = performance.now();
  const animate = (now: number) => {
    const deltaTime = (now - lastFrameTime) / 1000; // time in seconds
    lastFrameTime = now;

    // Update camera based on input
    cameraController.update(deltaTime);
    beginDebugUIFrame();

    // Create the UI window and its widgets
    ImGui.Begin("Debug Controls");
    ImGui.Text(`FPS: ${ImGui.GetIO().Framerate.toFixed(2)}`);
    ImGui.Text("Camera Controls: Click canvas to lock pointer.");
    ImGui.Text("WASD: Move, Shift: Down, Space: Up");
    ImGui.Text("Light Controls");

    if (ImGui.ColorEdit3("Ambient Color", ambientColorUI)) {
      scene.ambientColor[0] = ambientColorUI[0];
      scene.ambientColor[1] = ambientColorUI[1];
      scene.ambientColor[2] = ambientColorUI[2];
    }
    // Edit the UI arrays (not the light colors directly)
    if (ImGui.ColorEdit4("Light 1 Color", light1ColorUI)) {
      // When UI changes, copy values to the actual light
      light1.color[0] = light1ColorUI[0];
      light1.color[1] = light1ColorUI[1];
      light1.color[2] = light1ColorUI[2];
      light1.color[3] = light1ColorUI[3];
    }

    if (ImGui.ColorEdit4("Light 2 Color", light2ColorUI)) {
      // When UI changes, copy values to the actual light
      light2.color[0] = light2ColorUI[0];
      light2.color[1] = light2ColorUI[1];
      light2.color[2] = light2ColorUI[2];
      light2.color[3] = light2ColorUI[3];
    }

    ImGui.End();

    // Animate the lights in circles around the objects
    const time = now / 1000; // time in seconds
    const radius = 3.0;
    light1.position[0] = Math.sin(time * 0.7) * radius;
    light1.position[1] = 2.0;
    light1.position[2] = Math.cos(time * 0.7) * radius;
    light1.position[3] = 1.0; // Keep w=1 for position

    light2.position[0] = Math.sin(-time * 0.4) * radius;
    light2.position[1] = 2.0;
    light2.position[2] = Math.cos(-time * 0.4) * radius;
    light2.position[3] = 1.0; // Keep w=1 for position

    renderer.render(camera, scene, renderDebugUI);
    requestAnimationFrame(animate);
  };

  // Start the animation loop.
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

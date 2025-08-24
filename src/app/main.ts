// src/app/main.ts
import { Renderer } from "@/core/renderer";
import "@/style.css";
import { mat4, vec3 } from "wgpu-matrix";
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

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) {
  throw new Error("Canvas element not found");
}

try {
  /*
  // Synchronize canvas bitmap size with its display size.
  // This must be done before the Renderer is initialized so that the
  // first depth texture it creates has the correct dimensions.
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  */
  const renderer = new Renderer(canvas);
  await renderer.init();

  await initDebugUI(canvas, renderer.device);

  const resourceManager = new ResourceManager(renderer);
  const scene = new Scene();
  const camera = new Camera();

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
  );

  // Create Scene Lights
  // light positions will be set in animate loop
  const light1: Light = {
    position: vec3.create(),
    color: vec3.fromValues(1, 0, 0), // Red light
  };
  scene.lights.push(light1);

  const light2: Light = {
    position: vec3.create(),
    color: vec3.fromValues(0, 0, 1), // Blue light
  };
  scene.lights.push(light2);

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
  const scaleVec = vec3.fromValues(0.07, 0.07, 0.07);

  // Teapot 1 (Bottom, White)
  const teapot1Matrix = mat4.identity();
  mat4.scale(teapot1Matrix, scaleVec, teapot1Matrix);
  scene.add({
    mesh: teapotMesh,
    modelMatrix: teapot1Matrix,
    material: material1,
  });

  // Teapot 2 (Middle, Red)
  const teapot2Matrix = mat4.identity();
  mat4.scale(teapot2Matrix, scaleVec, teapot2Matrix);
  mat4.translate(teapot2Matrix, vec3.fromValues(0, 0, 1), teapot2Matrix);
  scene.add({
    mesh: teapotMesh,
    modelMatrix: teapot2Matrix,
    material: material2,
  });

  // Teapot 3 (Top, Blue)
  const teapot3Matrix = mat4.identity();
  mat4.scale(teapot3Matrix, scaleVec, teapot3Matrix);
  mat4.translate(teapot3Matrix, vec3.fromValues(0, 0, 2), teapot3Matrix);
  scene.add({
    mesh: teapotMesh,
    modelMatrix: teapot3Matrix,
    material: material3,
  });

  const UI_STATE = {
    light1Color: { r: light1.color[0], g: light1.color[1], b: light1.color[2] },
    light2Color: { r: light2.color[0], g: light2.color[1], b: light2.color[2] },
  };

  // Animation Loop
  const animate = (now: number) => {
    const time = now / 1000; // time in seconds

    beginDebugUIFrame();

    // Create the UI window and its widgets
    ImGui.Begin("Debug Controls");
    ImGui.Text(`FPS: ${ImGui.GetIO().Framerate.toFixed(2)}`);
    ImGui.Text("Light Controls");
    if (ImGui.ColorEdit3("Light 1 Color", UI_STATE.light1Color)) {
      light1.color[0] = UI_STATE.light1Color.r;
      light1.color[1] = UI_STATE.light1Color.g;
      light1.color[2] = UI_STATE.light1Color.b;
    }
    if (ImGui.ColorEdit3("Light 2 Color", UI_STATE.light2Color)) {
      light2.color[0] = UI_STATE.light2Color.r;
      light2.color[1] = UI_STATE.light2Color.g;
      light2.color[2] = UI_STATE.light2Color.b;
    }
    ImGui.End();

    // Animate the lights in circles around the objects
    const radius = 3.0;
    light1.position[0] = Math.sin(time * 0.7) * radius;
    light1.position[1] = 2.0;
    light1.position[2] = Math.cos(time * 0.7) * radius;

    light2.position[0] = Math.sin(-time * 0.4) * radius;
    light2.position[1] = 2.0;
    light2.position[2] = Math.cos(-time * 0.4) * radius;

    // Rotate all the teapots together
    mat4.rotateZ(teapot1Matrix, 0.005, teapot1Matrix);
    mat4.rotateZ(teapot2Matrix, 0.005, teapot2Matrix);
    mat4.rotateZ(teapot3Matrix, 0.005, teapot3Matrix);

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

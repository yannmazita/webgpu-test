// src/main.ts
import { Renderer } from "@/core/renderer";
import "@/style.css";
import { mat4, vec3 } from "wgpu-matrix";
import { Camera } from "@/core/camera";
import { ResourceManager } from "./core/resourceManager";
import { Scene } from "./core/scene";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) {
  throw new Error("Canvas element not found");
}

try {
  const renderer = new Renderer(canvas);
  await renderer.init();

  const resourceManager = new ResourceManager(renderer);
  const scene = new Scene();
  const camera = new Camera();
  // Initialize the GPU resources of the camera using the layout from the renderer
  camera.init(renderer.device, renderer.getCameraBindGroupLayout());

  // Configure camera projection
  const aspectRatio = canvas.width / canvas.height;
  camera.setPerspective(
    (90 * Math.PI) / 180, // 90 degrees field of view
    aspectRatio,
    0.1,
    100.0,
  );

  // Position the camera to look at the scene
  camera.lookAt(
    vec3.fromValues(0, 0, 1.5),
    vec3.fromValues(0, 0, 0),
    vec3.fromValues(0, 1, 0),
  );

  // Create materials and meshes
  const [material1, material2, triforceMesh] = await Promise.all([
    resourceManager.createMaterial("/assets/rms.jpg"),
    resourceManager.createMaterial("/assets/rms2.jpg"),
    Promise.resolve(resourceManager.createTriforceMesh()),
  ]);

  // Create three renderable objects and add them to the scene.
  scene.add({
    mesh: triforceMesh,
    modelMatrix: mat4.translation([0, 0.5, 0]),
    material: material2,
  });

  scene.add({
    mesh: triforceMesh,
    modelMatrix: mat4.translation([-0.5, -0.5, 0]),
    material: material1,
  });

  scene.add({
    mesh: triforceMesh,
    modelMatrix: mat4.translation([0.5, -0.5, 0]),
    material: material1,
  });

  renderer.render(camera, scene);
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
    "Could not initialize the graphics engine. Please ensure you are using a modern browser or a browser with modern features.";

  const details = document.createElement("pre");
  details.textContent = (error as Error).message;

  // Append the new elements to the error container
  errorContainer.appendChild(header);
  errorContainer.appendChild(message);
  errorContainer.appendChild(details);

  // Replace the canvas with the error message
  appContainer?.replaceChildren(errorContainer);
}

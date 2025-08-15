// src/main.ts
import { Renderer } from "@/core/renderer";
import { createTriforceMesh } from "@/features/triforce/meshes/triforceMesh";
import "@/style.css";
import { Renderable } from "@/core/types/gpu";
import { mat4, vec3 } from "wgpu-matrix";
import { Camera } from "@/core/camera";
import { Material } from "./core/material";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) {
  throw new Error("Canvas element not found");
}

try {
  const renderer = new Renderer(canvas);
  await renderer.init();

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

  // Create two materials
  const material1 = new Material();
  await material1.init(
    renderer.device,
    "/assets/rms.jpg",
    renderer.getMaterialBindGroupLayout(),
    renderer.getModelUniformBuffer(),
    renderer.getAlignedMatrixSize(),
  );

  const material2 = new Material();
  await material2.init(
    renderer.device,
    "/assets/rms2.jpg",
    renderer.getMaterialBindGroupLayout(),
    renderer.getModelUniformBuffer(),
    renderer.getAlignedMatrixSize(),
  );

  // Create one mesh, which will be shared by all renderable objects.
  const triforceMesh = createTriforceMesh(renderer.device);

  // Create three renderable objects, each with a unique model matrix.
  const scene: Renderable[] = [
    {
      mesh: triforceMesh,
      modelMatrix: mat4.translation([0, 0.5, 0]),
      material: material2,
    },
    {
      mesh: triforceMesh,
      modelMatrix: mat4.translation([-0.5, -0.5, 0]),
      material: material1,
    },
    {
      mesh: triforceMesh,
      modelMatrix: mat4.translation([0.5, -0.5, 0]),
      material: material1,
    },
  ];

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

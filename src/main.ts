// src/main.ts
import { Renderer } from "@/core/renderer";
import { createTriforceMesh } from "@/features/triforce/meshes/triforceMesh";
import "@/style.css";
import { Renderable } from "./core/types/gpu";
import { mat4 } from "wgpu-matrix";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvas) {
  throw new Error("Canvas element not found");
}

try {
  const renderer = new Renderer(canvas);
  await renderer.init();

  // Create one mesh, which will be shared by all renderable objects.
  const triforceMesh = createTriforceMesh(renderer.device);

  // Create three renderable objects, each with a unique model matrix.
  const scene: Renderable[] = [
    {
      mesh: triforceMesh,
      modelMatrix: mat4.translation([0, 0.5, 0]),
    },
    {
      mesh: triforceMesh,
      modelMatrix: mat4.translation([-0.5, -0.5, 0]),
    },
    {
      mesh: triforceMesh,
      modelMatrix: mat4.translation([0.5, -0.5, 0]),
    },
  ];

  renderer.render(scene);
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

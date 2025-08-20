// src/app/main.ts
import { Renderer } from "@/core/renderer";
import "@/style.css";
import { mat4, vec3 } from "wgpu-matrix";
import { Camera } from "@/core/camera";
import { ResourceManager } from "@/core/resourceManager";
import { Scene } from "@/core/scene";

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

  // Configure camera projection (this will be set properly by the resize handler)
  camera.setPerspective(
    (90 * Math.PI) / 180, // 90 degrees field of view
    1, // dummy aspect ratio
    0.1,
    100.0,
  );

  // Position the camera to look at the scene
  camera.lookAt(
    vec3.fromValues(0, 1, 0.5),
    vec3.fromValues(0, 0, 0),
    vec3.fromValues(0, 0, 1), // beetle is exported with z-up and not y-up
  );

  const [material, beetleMesh] = await Promise.all([
    resourceManager.createColorMaterial([1, 1, 1, 1]),
    resourceManager.loadMeshFromSTL("/assets/models/Utah_VW_Bug.stl"),
  ]);

  // Create renderable object and add to scene
  const beetleModelMatrix = mat4.identity();

  scene.add({
    mesh: beetleMesh,
    modelMatrix: beetleModelMatrix,
    material: material,
  });

  const handleResize = () => {
    const newWidth = canvas.clientWidth;
    const newHeight = canvas.clientHeight;

    // Prevent unnecessary updates if the size hasn't changed
    if (canvas.width === newWidth && canvas.height === newHeight) {
      return;
    }

    // Update the canvas drawing buffer size
    canvas.width = newWidth;
    canvas.height = newHeight;

    // Update renderer resources
    renderer.resizeCanvas();

    // Update camera projection
    camera.setPerspective(
      (90 * Math.PI) / 180, // 90 degrees field of view
      newWidth / newHeight,
      0.1,
      100.0,
    );
  };

  const canvasResizeObserver = new ResizeObserver(() => {
    handleResize();
  });
  canvasResizeObserver.observe(canvas);

  renderer.render(camera, scene);

  const startTime = performance.now(); // in milliseconds.

  const animate = (now: number) => {
    const time = (now - startTime) / 1000;

    mat4.rotateZ(beetleModelMatrix, 0.005, beetleModelMatrix);

    renderer.render(camera, scene);
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

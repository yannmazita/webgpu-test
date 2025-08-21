// src/app/main.ts
import { Renderer } from "@/core/renderer";
import "@/style.css";
import { mat4, vec3 } from "wgpu-matrix";
import { Camera } from "@/core/camera";
import { ResourceManager } from "@/core/resourceManager";
import { Scene } from "@/core/scene";
import { Light } from "@/core/types/gpu";

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

  // Configure camera projection
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
    vec3.fromValues(0, 0, 1), // beetle is exported with z-up
  );

  // Create Scene Light
  const light: Light = {
    position: vec3.fromValues(1, 1, 1), // Initial light position
    color: vec3.fromValues(1, 1, 1), // White light
  };
  scene.light = light;

  // Create Material and Mesh
  const [material, beetleMesh] = await Promise.all([
    resourceManager.createPhongMaterial({
      baseColor: [0.8, 0.1, 0.1, 1.0], // Red
      specularColor: [0.1, 0.1, 0.1], // White highlights
      shininess: 50.0,
    }),
    resourceManager.loadMeshFromSTL("/assets/models/Utah_VW_Bug.stl"),
  ]);

  // Create renderable object and add to scene
  const beetleModelMatrix = mat4.identity();
  //mat4.scale(beetleModelMatrix, vec3.fromValues(0.1, 0.1, 0.1), beetleModelMatrix);

  scene.add({
    mesh: beetleMesh,
    modelMatrix: beetleModelMatrix,
    material: material,
  });

  const handleResize = () => {
    const newWidth = canvas.clientWidth;
    const newHeight = canvas.clientHeight;

    if (canvas.width === newWidth && canvas.height === newHeight) {
      return;
    }

    canvas.width = newWidth;
    canvas.height = newHeight;
    renderer.resizeCanvas();

    camera.setPerspective(
      (90 * Math.PI) / 180,
      newWidth / newHeight,
      0.1,
      100.0,
    );
  };

  const canvasResizeObserver = new ResizeObserver(handleResize);
  canvasResizeObserver.observe(canvas);
  handleResize();

  // Animation Loop
  const animate = (now: number) => {
    const time = now / 1000; // time in seconds

    // Animate the light in a circle around the object
    /*
    const radius = 4.0;
    scene.light.position[0] = Math.sin(time * 0.5) * radius;
    scene.light.position[1] = Math.cos(time * 0.5) * radius;
    scene.light.position[2] = 2.0;
    */

    // Rotate the beetle
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
    "Could not initialize the graphics engine. Please ensure you are using a modern browser that supports WebGPU.";

  const details = document.createElement("pre");
  details.textContent = (error as Error).message;

  errorContainer.appendChild(header);
  errorContainer.appendChild(message);
  errorContainer.appendChild(details);

  appContainer.replaceChildren(errorContainer);
}

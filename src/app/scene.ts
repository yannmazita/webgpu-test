// src/app/scene.ts
import { World } from "@/core/ecs/world";
import { ResourceManager } from "@/core/resources/resourceManager";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { MainCameraTagComponent } from "@/core/ecs/components/tagComponents";
import { LightComponent } from "@/core/ecs/components/lightComponent";
import { MeshRendererComponent } from "@/core/ecs/components/meshRendererComponent";
import {
  createCubeMeshData,
  createIcosphereMeshData,
} from "@/core/utils/primitives";
import { mat4, quat, vec3 } from "wgpu-matrix";
import { SkyboxComponent } from "@/core/ecs/components/skyboxComponent";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/sunComponent";
import { FogComponent } from "@/core/ecs/components/fogComponent";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
} from "@/core/ecs/components/physicsComponents";
import { PRNG } from "@/core/utils/prng";

async function createTallStaticObjects(
  world: World,
  resourceManager: ResourceManager,
  count: number,
): Promise<void> {
  console.log(`[Scene] Creating ${count} tall static objects...`);

  // Create a single shared mesh and material for this quick demo
  const boxMesh = await resourceManager.createMesh(
    "tall_box_unit",
    createCubeMeshData(1),
  );
  const boxMaterial = await resourceManager.createPBRMaterialInstance(
    await resourceManager.createPBRMaterialTemplate({
      albedo: [0.4, 0.45, 0.5, 1],
      metallic: 0.1,
      roughness: 0.8,
    }),
  );

  const prng = new PRNG(1337); // Seeded PRNG for deterministic layout
  const SPREAD = 80;
  const HALF_SPREAD = SPREAD / 2;

  for (let i = 0; i < count; i++) {
    const entity = world.createEntity(`tall_static_${i}`);
    const transform = new TransformComponent();

    const scaleX = prng.range(0.5, 2.0);
    const scaleY = prng.range(20, 100);
    const scaleZ = prng.range(0.5, 2.0);
    transform.setScale(scaleX, scaleY, scaleZ);

    const x = prng.range(-HALF_SPREAD, HALF_SPREAD);
    const z = prng.range(-HALF_SPREAD, HALF_SPREAD);
    // Position Y is half the height so the base is at y=0
    transform.setPosition(x, scaleY / 2 - 2, z);

    // Add visual components
    world.addComponent(entity, transform);
    world.addComponent(entity, new MeshRendererComponent(boxMesh, boxMaterial));

    // Add physics components
    const body = new PhysicsBodyComponent(false); // static
    const collider = new PhysicsColliderComponent(1, [
      scaleX / 2,
      scaleY / 2,
      scaleZ / 2,
    ]); // box (half-extents)
    world.addComponent(entity, body);
    world.addComponent(entity, collider);
  }
  console.log(`[Scene] ${count} tall static objects created.`);
}

export async function createDefaultScene(
  world: World,
  resourceManager: ResourceManager,
): Promise<{
  cameraEntity: number;
  demoModelEntity: number;
  keyLightEntity: number;
  fillLightEntity: number;
  rimLightEntity: number;
}> {
  // Environment Map & IBL
  console.log("[Scene] Awaiting environment map...");
  const envMap = await resourceManager.createEnvironmentMap(
    "/assets/hdris/citrus_orchard_road_puresky_4k.hdr",
    1024,
  );
  console.log("[Scene] Environment map created.");
  world.addResource(new SkyboxComponent(envMap.skyboxMaterial));
  world.addResource(envMap.iblComponent);

  // Camera
  const cameraEntity = world.createEntity();
  const cameraTransform = new TransformComponent();

  const orbitRadius = 15.0;
  const orbitHeight = 2.0;
  const initialX = orbitRadius;
  const initialY = orbitHeight;
  const initialZ = 0;

  const eye = vec3.fromValues(initialX, initialY, initialZ);
  const target = vec3.fromValues(0, 0, 0);
  const up = vec3.fromValues(0, 1, 0);

  const view = mat4.lookAt(eye, target, up);
  const worldFromView = mat4.invert(view);
  const rotation = quat.fromMat(worldFromView);

  cameraTransform.setPosition(initialX, initialY, initialZ);
  cameraTransform.setRotation(rotation);

  world.addComponent(cameraEntity, cameraTransform);
  world.addComponent(
    cameraEntity,
    new CameraComponent(45, 16 / 9, 0.1, 1000.0),
  );
  world.addComponent(cameraEntity, new MainCameraTagComponent());

  // Volumetric Fog
  const fog = new FogComponent();
  fog.color.set([0.1, 0.1, 0.12, 1.0]);
  fog.density = 0.1;
  fog.height = -5.0;
  fog.heightFalloff = 0.05;
  fog.inscatteringIntensity = 4.0;
  world.addResource(fog);

  // Demo model: Force sphere for physics test
  let demoModelEntity = -1;
  try {
    // Comment out GLTF for sphere demo test
    /*
    console.log("[Scene] Awaiting GLTF scene load...");
    demoModelEntity = await resourceManager.loadSceneFromGLTF(
      world,
      "/assets/models/gltf/khronos-samples/AnimatedColorsCube.glb",
    );
    console.log("[Scene] GLTF scene loaded.");
    */

    // Force sphere fallback for demo (visual + physics test)
    console.log("[Scene] Creating sphere demo model...");
    demoModelEntity = world.createEntity("demo_sphere");
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
      "demo_sphere",
      createIcosphereMeshData(1.0, 3), // radius=1, sub=3 for smooth sphere
    );
    const demoModelTransform = new TransformComponent();
    demoModelTransform.setPosition(0, 5, 0); // Start elevated for fall test
    demoModelTransform.setScale(1, 1, 1);
    world.addComponent(demoModelEntity, demoModelTransform);
    world.addComponent(
      demoModelEntity,
      new MeshRendererComponent(sphereMesh, fallbackInstance),
    );
    console.log("[Scene] Sphere demo model created (r=1 at y=5).");
  } catch (error) {
    console.error("Failed to create demo sphere:", error);
    throw error; // Ensure scene fails if demo can't load
  }

  // Physics: Make the demo model a dynamic sphere (r=1). Acts as our falling test body.
  {
    const body = new PhysicsBodyComponent(true); // dynamic
    const collider = new PhysicsColliderComponent(0, [1, 0, 0]); // sphere radius=1
    world.addComponent(demoModelEntity, body);
    world.addComponent(demoModelEntity, collider);
    console.log("[Scene] Added dynamic physics to demo sphere (r=1 at y=5).");
  }

  // Lighting setup
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

  const keyLightEntity = world.createEntity();
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

  const fillLightEntity = world.createEntity();
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

  const rimLightEntity = world.createEntity();
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

  // Static ground: visual + physics (large box collider/platform)
  {
    const groundEntity = world.createEntity("ground");
    const groundTransform = new TransformComponent();
    // Visual scale: large flat box centered at y=-3 (so surface at ~y=-2.5)
    groundTransform.setPosition(0, -3, 0);
    groundTransform.setScale(100, 1, 100); // big flat
    world.addComponent(groundEntity, groundTransform);

    // Physics: static body with box collider matching half-extents ~ scale (of render transform)/2
    const groundBody = new PhysicsBodyComponent(false); // static
    const hx = 50,
      hy = 0.5,
      hz = 50; // half extents
    const groundCollider = new PhysicsColliderComponent(1, [hx, hy, hz]); // box
    world.addComponent(groundEntity, groundBody);
    world.addComponent(groundEntity, groundCollider);

    // Visual mesh/material (unlit gray for ground)
    const groundMat = await resourceManager.createUnlitGroundMaterial({
      color: [0.15, 0.15, 0.15, 1],
    });
    const groundMesh = await resourceManager.createMesh(
      "ground_cube_unit",
      createCubeMeshData(1),
    );
    world.addComponent(
      groundEntity,
      new MeshRendererComponent(groundMesh, groundMat),
    );

    console.log("[Scene] Added static ground (box collider) at y=-3.");
  }

  // Add tall static objects
  await createTallStaticObjects(world, resourceManager, 200);

  // Sun and shadows
  world.addResource(new SceneSunComponent());
  world.addResource(new ShadowSettingsComponent());

  return {
    cameraEntity,
    demoModelEntity,
    keyLightEntity,
    fillLightEntity,
    rimLightEntity,
  };
}

// src/app/scene.ts
import { World } from "@/core/ecs/world";
import { ResourceManager } from "@/core/resources/resourceManager";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { MainCameraTagComponent } from "@/core/ecs/components/tagComponents";
import { LightComponent } from "@/core/ecs/components/lightComponent";
import { MeshRendererComponent } from "@/core/ecs/components/meshRendererComponent";
import { createIcosphereMeshData } from "@/core/utils/primitives";
import { mat4, quat, vec3 } from "wgpu-matrix";
import { SkyboxComponent } from "@/core/ecs/components/skyboxComponent";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/sunComponent";
import { FogComponent } from "@/core/ecs/components/fogComponent";

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

  // Load the demo model
  let demoModelEntity = -1;
  try {
    console.log("[Scene] Awaiting GLTF scene load...");
    demoModelEntity = await resourceManager.loadSceneFromGLTF(
      world,
      "/assets/models/gltf/khronos-samples/AnimatedColorsCube.glb",
    );
    console.log("[Scene] GLTF scene loaded.");

    const demoModelTransform = world.getComponent(
      demoModelEntity,
      TransformComponent,
    )!;
    demoModelTransform.setPosition(0, 0, 0);
    demoModelTransform.setScale(1, 1, 1);
  } catch (error) {
    console.error("Failed to load model:", error);
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

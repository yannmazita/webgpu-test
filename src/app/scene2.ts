// src/app/scene2.ts
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
  createPlaneMeshData,
} from "@/core/utils/primitives";
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
import { PlayerControllerComponent } from "@/core/ecs/components/playerControllerComponent";
import { WeaponComponent } from "@/core/ecs/components/weaponComponent";
import { HealthComponent } from "@/core/ecs/components/healthComponent";

/**
 * Procedurally generates a "forest" of tall, static pillars for the player
 * to navigate.
 * @param world The ECS world.
 * @param resourceManager The resource manager for creating shared assets.
 * @param count The number of pillars to create.
 */
async function createPillarForest(
  world: World,
  resourceManager: ResourceManager,
  count: number,
): Promise<void> {
  console.log(`[Scene] Creating ${count} pillars...`);

  // Create a single shared mesh and material for efficiency.
  const boxMesh = await resourceManager.createMesh(
    "pillar_mesh",
    createCubeMeshData(1),
  );
  const boxMaterial = await resourceManager.createPBRMaterialInstance(
    await resourceManager.createPBRMaterialTemplate({
      albedo: [0.4, 0.45, 0.5, 1],
      metallic: 0.1,
      roughness: 0.8,
    }),
  );

  const prng = new PRNG(1337); // Seeded for deterministic layout
  const SPREAD = 120;
  const HALF_SPREAD = SPREAD / 2;

  for (let i = 0; i < count; i++) {
    const entity = world.createEntity(`pillar_${i}`);
    const transform = new TransformComponent();

    const scaleX = prng.range(0.8, 3.0);
    const scaleY = prng.range(10, 60);
    const scaleZ = prng.range(0.8, 3.0);
    transform.setScale(scaleX, scaleY, scaleZ);

    const x = prng.range(-HALF_SPREAD, HALF_SPREAD);
    const z = prng.range(-HALF_SPREAD, HALF_SPREAD);
    // Position Y is half the height, placing the base at y=0 on the ground.
    transform.setPosition(x, scaleY / 2, z);

    // Add visual components
    world.addComponent(entity, transform);
    world.addComponent(entity, new MeshRendererComponent(boxMesh, boxMaterial));

    // Add physics components: a static (fixed) body with a box collider.
    world.addComponent(entity, new PhysicsBodyComponent("fixed"));
    world.addComponent(
      entity,
      new PhysicsColliderComponent(1, [scaleX / 2, scaleY / 2, scaleZ / 2]),
    );
  }
}

/**
 * Creates a playable scene with a procedural environment and dynamic objects.
 *
 * @remarks
 * This function sets up the entire game world by orchestrating the creation of
 * all necessary entities and resources. It loads the skybox and IBL environment,
 * creates a player entity with physics and controls, sets up global fog,
 * procedurally generates a tiled ground plane and a forest of pillars, and
 * places lights and dynamic physics objects in the world.
 *
 * @param world The ECS world where all entities will be created.
 * @param resourceManager The resource manager used for
 *     creating and loading all mesh and material assets.
 * @returns
 *     A promise that resolves to an object containing the entity IDs of key
 *     objects in the scene, which can be used for debugging or by other
 *     systems.
 */
export async function createScene(
  world: World,
  resourceManager: ResourceManager,
): Promise<{
  cameraEntity: number;
  playerEntity: number;
  keyLightEntity: number;
  fillLightEntity: number;
  rimLightEntity: number;
}>;
export async function createScene(
  world: World,
  resourceManager: ResourceManager,
): Promise<{
  cameraEntity: number;
  playerEntity: number;
  keyLightEntity: number;
  fillLightEntity: number;
  rimLightEntity: number;
}> {
  // --- Environment & Skybox ---
  const envMap = await resourceManager.createEnvironmentMap(
    "/assets/hdris/citrus_orchard_road_puresky_4k.hdr",
    1024,
  );
  world.addResource(new SkyboxComponent(envMap.skyboxMaterial));
  world.addResource(envMap.iblComponent);

  // --- Camera ---
  // The camera entity is created here, but its transform will be managed by
  // the PlayerControllerSystem each frame to follow the player.
  const cameraEntity = world.createEntity("main_camera");
  world.addComponent(
    cameraEntity,
    new CameraComponent(45, 16 / 9, 0.1, 1000.0),
  );
  world.addComponent(cameraEntity, new MainCameraTagComponent());
  // A placeholder transform is added, but it will be overwritten.
  world.addComponent(cameraEntity, new TransformComponent());

  // --- Player ---
  const playerEntity = world.createEntity("player");
  {
    const t = new TransformComponent();
    t.setPosition(0, 1, 10); // Start above ground.
    world.addComponent(playerEntity, t);

    // Physics: kinematic capsule, marked as the player.
    const bodyComp = new PhysicsBodyComponent("kinematicPosition", true);
    world.addComponent(playerEntity, bodyComp);
    const colliderComp = new PhysicsColliderComponent();
    colliderComp.setCapsule(0.4, 0.9); // Standard FPS capsule.
    world.addComponent(playerEntity, colliderComp);

    // Controller component to link input and physics.
    world.addComponent(playerEntity, new PlayerControllerComponent());
    // Weapon component for firing
    world.addComponent(playerEntity, new WeaponComponent());
  }

  // --- Fog ---
  const fog = new FogComponent();
  fog.color.set([0.1, 0.1, 0.12, 1.0]);
  fog.density = 0.02;
  fog.height = -5.0;
  fog.heightFalloff = 0.01;
  fog.inscatteringIntensity = 4.0;
  world.addResource(fog);

  // --- Ground Plane ---
  {
    const groundEntity = world.createEntity("ground_plane");
    const groundTransform = new TransformComponent();
    groundTransform.setPosition(0, 0, 0);
    world.addComponent(groundEntity, groundTransform);

    // Create a 200x200 plane mesh
    const groundMesh = await resourceManager.createMesh(
      "ground_plane_mesh",
      createPlaneMeshData(200),
    );

    // Create a material instance with UV tiling
    const groundMaterial = await resourceManager.createPBRMaterialInstance(
      await resourceManager.createPBRMaterialTemplate({}),
      {
        albedoMap: "/assets/textures/snow_02_4k/textures/snow_02_diff_4k.jpg",
        normalMap: "/assets/textures/snow_02_4k/textures/snow_02_nor_gl_4k.jpg",
        metallicRoughnessMap:
          "/assets/textures/snow_02_4k/textures/snow_02_rough_4k.jpg",
        metallic: 0.0, // Snow is not metallic
        uvScale: [100, 100], // Tile the texture 100 times across the 200-unit plane
      },
    );

    world.addComponent(
      groundEntity,
      new MeshRendererComponent(groundMesh, groundMaterial),
    );

    // Physics: A fixed body that cannot move.
    world.addComponent(groundEntity, new PhysicsBodyComponent("fixed"));
    world.addComponent(
      groundEntity,
      new PhysicsColliderComponent(1, [100, 0.5, 100]), // Half-extents for a 200x1x200 collider box
    );
  }

  // --- Pillar Forest ---
  await createPillarForest(world, resourceManager, 200);

  // --- Dynamic Physics Objects ---
  // Create a stack of cubes for the player to interact with.
  {
    const cubeMesh = await resourceManager.createMesh(
      "interactive_cube",
      createCubeMeshData(1),
    );
    const cubeMat = await resourceManager.createPBRMaterialInstance(
      await resourceManager.createPBRMaterialTemplate({
        albedo: [0.9, 0.5, 0.2, 1],
        metallic: 0.8,
        roughness: 0.2,
      }),
    );
    const CUBE_COUNT = 8;
    for (let i = 0; i < CUBE_COUNT; i++) {
      const cube = world.createEntity(`dynamic_cube_${i}`);
      const t = new TransformComponent();
      // Stack them vertically with a slight offset for stability.
      t.setPosition(5, 0.5 + i * 1.01, 5);
      world.addComponent(cube, t);
      world.addComponent(cube, new MeshRendererComponent(cubeMesh, cubeMat));
      // Physics: Dynamic body with a 1x1x1 box collider.
      world.addComponent(cube, new PhysicsBodyComponent("dynamic"));
      world.addComponent(
        cube,
        new PhysicsColliderComponent(1, [0.5, 0.5, 0.5]),
      );
      // Health component to make it a target
      world.addComponent(cube, new HealthComponent(50));
    }
  }

  // --- Lighting ---
  const lightMesh = await resourceManager.createMesh(
    "light_indicator",
    createIcosphereMeshData(0.2, 1),
  );
  const warmMat = await resourceManager.createPBRMaterialInstance(
    await resourceManager.createPBRMaterialTemplate({
      emissive: [1, 0.8, 0.6],
    }),
  );
  const coolMat = await resourceManager.createPBRMaterialInstance(
    await resourceManager.createPBRMaterialTemplate({
      emissive: [0.6, 0.8, 1],
    }),
  );

  const keyLightEntity = world.createEntity("key_light");
  {
    const t = new TransformComponent();
    t.setPosition(40, 50, 40);
    world.addComponent(keyLightEntity, t);
    world.addComponent(
      keyLightEntity,
      new LightComponent([1, 0.95, 0.8, 1], [0, 0, 0, 1], 80.0, 30.0),
    );
    world.addComponent(
      keyLightEntity,
      new MeshRendererComponent(lightMesh, warmMat),
    );
  }

  const fillLightEntity = world.createEntity("fill_light");
  {
    const t = new TransformComponent();
    t.setPosition(-30, 20, 30);
    world.addComponent(fillLightEntity, t);
    world.addComponent(
      fillLightEntity,
      new LightComponent([0.8, 0.9, 1, 1], [0, 0, 0, 1], 60.0, 15.0),
    );
    world.addComponent(
      fillLightEntity,
      new MeshRendererComponent(lightMesh, coolMat),
    );
  }

  const rimLightEntity = world.createEntity("rim_light");
  {
    const t = new TransformComponent();
    t.setPosition(0, 30, -50);
    world.addComponent(rimLightEntity, t);
    world.addComponent(
      rimLightEntity,
      new LightComponent([1, 1, 1, 1], [0, 0, 0, 1], 50.0, 20.0),
    );
  }

  // --- Global Sun and Shadow Settings ---
  world.addResource(new SceneSunComponent());
  world.addResource(new ShadowSettingsComponent());

  return {
    cameraEntity,
    playerEntity,
    keyLightEntity,
    fillLightEntity,
    rimLightEntity,
  };
}

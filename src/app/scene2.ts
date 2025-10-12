// src/app/scene2.ts
import { World } from "@/core/ecs/world";
import {
  PBRMaterialSpec,
  ResourceManager,
} from "@/core/resources/resourceManager";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { MainCameraTagComponent } from "@/core/ecs/components/tagComponents";
import { MeshRendererComponent } from "@/core/ecs/components/meshRendererComponent";
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
import { ResourceHandle } from "@/core/resources/resourceHandle";
import { CameraFollowComponent } from "@/core/ecs/components/cameraFollowComponent";
import { vec3 } from "wgpu-matrix";
import { InteractableComponent } from "@/core/ecs/components/interactableComponent";
import { PickupComponent } from "@/core/ecs/components/pickupComponent";
import { PBRMaterialOptions } from "@/core/types/gpu";

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
  const boxMesh = await resourceManager.resolveMeshByHandle(
    ResourceHandle.forMesh("PRIM:cube:size=1"),
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
}>;
export async function createScene(
  world: World,
  resourceManager: ResourceManager,
): Promise<{
  cameraEntity: number;
  playerEntity: number;
}> {
  // --- Environment & Skybox ---
  const envMap = await resourceManager.createEnvironmentMap(
    "/assets/hdris/citrus_orchard_road_puresky_4k.hdr",
    1024,
  );
  world.addResource(new SkyboxComponent(envMap.skyboxMaterial));
  world.addResource(envMap.iblComponent);

  // --- Pre-load Projectile Assets ---
  // Define handles and specs for projectile assets. By resolving them here during
  // scene setup, they are guaranteed to be in the cache for synchronous use
  // by the weaponSystem at runtime.
  const projectileMeshHandle = ResourceHandle.forMesh(
    "PRIM:icosphere:r=0.1,sub=1",
  );
  await resourceManager.resolveMeshByHandle(projectileMeshHandle);

  const projectileMaterialSpec: PBRMaterialSpec = {
    type: "PBR",
    options: {
      emissive: [1.0, 0.5, 0.1],
      emissiveStrength: 2.0,
      albedo: [1.0, 0.5, 0.1, 1.0],
    },
  };
  const projectileMaterialHandle = ResourceHandle.forMaterial(
    "projectile_material",
  );
  await resourceManager.resolveMaterialSpec(
    projectileMaterialSpec,
    projectileMaterialHandle.key,
  );

  // --- Player ---
  // Create player first so we can get its entity ID for the camera to follow.
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

    // Weapon component configured for projectile firing.
    const weapon = new WeaponComponent();
    weapon.isHitscan = false;
    weapon.fireRate = 4.0;
    weapon.damage = 5.0;
    weapon.projectileSpeed = 75.0;
    weapon.projectileLifetime = 1.5;
    weapon.projectileRadius = 0.1;
    weapon.projectileMeshHandle = projectileMeshHandle;
    weapon.projectileMaterialHandle = projectileMaterialHandle;
    world.addComponent(playerEntity, weapon);
  }

  // --- Camera ---
  // The camera entity now follows the player entity.
  const cameraEntity = world.createEntity("main_camera");
  world.addComponent(
    cameraEntity,
    new CameraComponent(45, 16 / 9, 0.1, 1000.0),
  );
  world.addComponent(cameraEntity, new MainCameraTagComponent());
  world.addComponent(cameraEntity, new TransformComponent());
  // Add the follow component
  world.addComponent(
    cameraEntity,
    new CameraFollowComponent(playerEntity, vec3.create(0, 1.6, 0)), // Target player, offset to head height
  );

  // --- Fog ---
  const fog = new FogComponent();
  fog.color.set([1, 1, 1, 1.0]);
  fog.density = 0.5;
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

    // creating the plane mesh
    const groundMesh = await resourceManager.resolveMeshByHandle(
      ResourceHandle.forMesh("PRIM:plane:size=200"),
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
        uvScale: [5, 5], // Tile the texture 10 times
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
      new PhysicsColliderComponent(1, [100, 0.001, 100]),
    );
  }

  // --- Texture Ball ---
  {
    const textureBallEntity = await resourceManager.loadSceneFromGLTF(
      world,
      "/assets/textures/snow_02_4k/snow_02_4k.gltf",
    );
    const textureBallTransform = new TransformComponent();
    textureBallTransform.setPosition(0, 2, 0);
    world.addComponent(textureBallEntity, textureBallTransform);

    world.addComponent(textureBallEntity, textureBallTransform);

    world.addComponent(textureBallEntity, new PhysicsBodyComponent("fixed"));
    world.addComponent(textureBallEntity, new PhysicsColliderComponent(0));
  }

  // --- Pillar Forest ---
  //await createPillarForest(world, resourceManager, 200);

  // --- Dynamic Physics Objects ---
  // Create a stack of cubes for the player to interact with.
  {
    const cubeMesh = await resourceManager.resolveMeshByHandle(
      ResourceHandle.forMesh("PRIM:cube:size=1"),
    );
    const whiteMaterialOptions: PBRMaterialOptions = {
      albedo: [0.9, 0.8, 0.9, 1],
      metallic: 0,
      roughness: 0.8,
    };
    const cubeMat = await resourceManager.createPBRMaterialInstance(
      await resourceManager.createPBRMaterialTemplate(whiteMaterialOptions),
      whiteMaterialOptions,
    );

    const CUBE_COUNT = 8;
    for (let i = 0; i < CUBE_COUNT; i++) {
      const cube = world.createEntity(`dynamic_cube_${i}`);
      const t = new TransformComponent();
      // Stack them vertically with a slight offset so that they fall
      t.setPosition(5, 0.5 + i * 10.01, 5);
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

    // Create a special "pickup" cube
    const pickupCube = world.createEntity("pickup_cube_health");
    const greenMaterialOptions: PBRMaterialOptions = {
      albedo: [0.1, 0.8, 0.2, 1.0],
      emissive: [0.1, 0.8, 0.2],
      emissiveStrength: 5,
    };
    const pickupCubeMat = await resourceManager.createPBRMaterialInstance(
      await resourceManager.createPBRMaterialTemplate(greenMaterialOptions),
      greenMaterialOptions,
    );

    const t = new TransformComponent();
    t.setPosition(-3, 0.5, 2);
    world.addComponent(pickupCube, t);
    world.addComponent(
      pickupCube,
      new MeshRendererComponent(cubeMesh, pickupCubeMat),
    );
    world.addComponent(pickupCube, new PhysicsBodyComponent("dynamic"));
    world.addComponent(
      pickupCube,
      new PhysicsColliderComponent(1, [0.5, 0.5, 0.5]),
    );

    // Add interaction and pickup components to make it a health pack
    world.addComponent(
      pickupCube,
      new InteractableComponent("Press [E] to pick up Health Pack", 3.0),
    );
    world.addComponent(pickupCube, new PickupComponent("health_pack", 25));
  }

  // --- Global Sun and Shadow Settings ---
  world.addResource(new SceneSunComponent());
  world.addResource(new ShadowSettingsComponent());

  return {
    cameraEntity,
    playerEntity,
  };
}

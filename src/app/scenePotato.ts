// src/app/potato.ts
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
import { PlayerControllerComponent } from "@/core/ecs/components/playerControllerComponent";
import { WeaponComponent } from "@/core/ecs/components/weaponComponent";
import { HealthComponent } from "@/core/ecs/components/healthComponent";
import { ResourceHandle } from "@/core/resources/resourceHandle";
import { CameraFollowComponent } from "@/core/ecs/components/cameraFollowComponent";
import { vec3 } from "wgpu-matrix";
import { InteractableComponent } from "@/core/ecs/components/interactableComponent";
import { PickupComponent } from "@/core/ecs/components/pickupComponent";
import { PBRMaterialOptions } from "@/core/types/gpu";
import { Entity } from "@/core/ecs/entity";
import { RespawnComponent } from "@/core/ecs/components/respawnComponent";
import { SpawnPointComponent } from "@/core/ecs/components/spawnPointComponent";

/**
 * Creates a player entity with all necessary components.
 * @remarks
 * This function acts as a "prefab" for the player. It is registered with the
 * `PrefabFactory` and can be called to instantiate a new player at any time,
 * for example, at the start of the game or upon respawning.
 * @param world The ECS world.
 * @param resourceManager The resource manager.
 * @param transform The initial transform for the player.
 * @returns A promise that resolves to the created player entity ID.
 */
export async function createPlayerPrefab(
  world: World,
  resourceManager: ResourceManager,
  transform: TransformComponent,
): Promise<Entity> {
  const playerEntity = world.createEntity("player");

  // Use the provided transform for position/rotation
  world.addComponent(playerEntity, transform);

  // Physics: kinematic capsule, marked as the player.
  const bodyComp = new PhysicsBodyComponent("kinematicPosition", true);
  world.addComponent(playerEntity, bodyComp);
  const colliderComp = new PhysicsColliderComponent();
  colliderComp.setCapsule(0.4, 0.9); // Standard FPS capsule.
  world.addComponent(playerEntity, colliderComp);

  // Controller component to link input and physics.
  world.addComponent(playerEntity, new PlayerControllerComponent());

  // Health and Respawn
  world.addComponent(playerEntity, new HealthComponent(100));
  world.addComponent(
    playerEntity,
    new RespawnComponent("player", 5.0, "player_spawn"),
  );

  // Weapon component configured for projectile firing.
  // Pre-loading projectile assets
  const projectileMeshHandle = ResourceHandle.forMesh(
    "PRIM:icosphere:r=0.1,sub=1",
  );
  const projectileMaterialHandle = ResourceHandle.forMaterial(
    "projectile_material",
  );

  const weapon = new WeaponComponent();
  weapon.isHitscan = false;
  weapon.fireRate = 4.0;
  weapon.damage = 25.0; // Increased damage for testing
  weapon.projectileSpeed = 75.0;
  weapon.projectileLifetime = 1.5;
  weapon.projectileRadius = 0.1;
  weapon.projectileMeshHandle = projectileMeshHandle;
  weapon.projectileMaterialHandle = projectileMaterialHandle;
  world.addComponent(playerEntity, weapon);

  return playerEntity;
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
  // Create the initial player instance
  const initialPlayerTransform = new TransformComponent();
  initialPlayerTransform.setPosition(0, 1, 10); // Start above ground
  const playerEntity = await createPlayerPrefab(
    world,
    resourceManager,
    initialPlayerTransform,
  );

  // --- Camera ---
  // The camera entity follows the player entity.
  const cameraEntity = world.createEntity("main_camera");
  world.addComponent(
    cameraEntity,
    new CameraComponent(45, 16 / 9, 0.1, 1000.0),
  );
  world.addComponent(cameraEntity, new MainCameraTagComponent());
  world.addComponent(cameraEntity, new TransformComponent());
  world.addComponent(
    cameraEntity,
    new CameraFollowComponent(playerEntity, vec3.create(0, 1.6, 0)), // Target player, offset to head height
  );

  // --- Spawn Points ---
  const spawnPoint1 = world.createEntity("spawn_point_1");
  const t1 = new TransformComponent();
  t1.setPosition(0, 1, 10);
  world.addComponent(spawnPoint1, t1);
  world.addComponent(spawnPoint1, new SpawnPointComponent("player_spawn"));

  const spawnPoint2 = world.createEntity("spawn_point_2");
  const t2 = new TransformComponent();
  t2.setPosition(15, 1, 15);
  world.addComponent(spawnPoint2, t2);
  world.addComponent(spawnPoint2, new SpawnPointComponent("player_spawn"));

  const spawnPoint3 = world.createEntity("spawn_point_3");
  const t3 = new TransformComponent();
  t3.setPosition(-15, 1, -15);
  world.addComponent(spawnPoint3, t3);
  world.addComponent(spawnPoint3, new SpawnPointComponent("player_spawn"));

  // --- Fog ---
  const fog = new FogComponent();
  fog.color.set([1, 1, 1, 1.0]);
  fog.density = 0.0; // No fog
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
      ResourceHandle.forMesh("PRIM:plane:size=50"),
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

    if (groundMesh) {
      world.addComponent(
        groundEntity,
        new MeshRendererComponent(groundMesh, groundMaterial),
      );
    }

    // Physics: A fixed body that cannot move.
    world.addComponent(groundEntity, new PhysicsBodyComponent("fixed"));
    world.addComponent(
      groundEntity,
      new PhysicsColliderComponent(1, [25, 0.001, 25]),
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
      if (cubeMesh) {
        world.addComponent(cube, new MeshRendererComponent(cubeMesh, cubeMat));
      }
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
    if (cubeMesh) {
      world.addComponent(
        pickupCube,
        new MeshRendererComponent(cubeMesh, pickupCubeMat),
      );
    }
    world.addComponent(pickupCube, new PhysicsBodyComponent("dynamic"));
    world.addComponent(
      pickupCube,
      new PhysicsColliderComponent(1, [0.5, 0.5, 0.5]),
    );

    // Add interaction and pickup components to make it a health pack
    world.addComponent(
      pickupCube,
      new InteractableComponent("Press [E] to pick up Health Pack", 8.0),
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

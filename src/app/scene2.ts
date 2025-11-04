// src/app/scene2.ts
import { World } from "@/core/ecs/world";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { MainCameraTagComponent } from "@/core/ecs/components/tagComponents";
import { MeshRendererComponent } from "@/core/ecs/components/render/meshRendererComponent";
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
import { ResourceHandle, ResourceType } from "@/core/resources/resourceHandle";
import { CameraFollowComponent } from "@/core/ecs/components/cameraFollowComponent";
import { vec3 } from "wgpu-matrix";
import { InteractableComponent } from "@/core/ecs/components/interactableComponent";
import { PickupComponent } from "@/core/ecs/components/pickupComponent";
import { Entity } from "@/core/ecs/entity";
import { RespawnComponent } from "@/core/ecs/components/respawnComponent";
import { SpawnPointComponent } from "@/core/ecs/components/spawnPointComponent";
import { ResourceLoadingSystem } from "@/core/ecs/systems/ressources/resourceLoadingSystem";
import { PBRMaterialSpec } from "@/core/types/material";
import { createMaterialSpecKey } from "@/core/utils/material";
import {
  IBLResourceComponent,
  MaterialResourceComponent,
  MeshResourceComponent,
} from "@/core/ecs/components/resources/resourceComponents";
import { PBRMaterialSpecComponent } from "@/core/ecs/components/resources/materialSpecComponent";

/**
 * Creates a player entity with all necessary components.
 * @remarks
 * This function acts as a "prefab" for the player. It is registered with the
 * `PrefabFactory` and can be called to instantiate a new player at any time,
 * for example, at the start of the game or upon respawning.
 * @param world - The ECS world.
 * @param transform - The initial transform for the player.
 * @returns The created player entity ID.
 */
export function createPlayerPrefab(
  world: World,
  transform: TransformComponent,
): Entity {
  const playerEntity = world.createEntity("player");

  world.addComponent(playerEntity, transform);

  const bodyComp = new PhysicsBodyComponent("kinematicPosition", true);
  world.addComponent(playerEntity, bodyComp);
  const colliderComp = new PhysicsColliderComponent();
  colliderComp.setCapsule(0.4, 0.9);
  world.addComponent(playerEntity, colliderComp);

  world.addComponent(playerEntity, new PlayerControllerComponent());
  world.addComponent(playerEntity, new HealthComponent(100));
  world.addComponent(
    playerEntity,
    new RespawnComponent("player", 5.0, "player_spawn"),
  );

  const projectileMeshHandle = ResourceHandle.forMesh(
    "PRIM:icosphere:r=0.1,sub=1",
  );
  const projectileMaterialSpec: PBRMaterialSpec = {
    type: "PBR",
    options: {
      emissive: [1.0, 0.5, 0.1],
      emissiveStrength: 2.0,
      albedo: [1.0, 0.5, 0.1, 1.0],
    },
  };
  const projectileMaterialKey = createMaterialSpecKey(projectileMaterialSpec);
  const projectileMaterialHandle = ResourceHandle.forMaterial(
    projectileMaterialKey,
  );

  const weapon = new WeaponComponent();
  weapon.isHitscan = false;
  weapon.fireRate = 4.0;
  weapon.damage = 25.0;
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
 * @param world - The ECS world where all entities will be created.
 * @param resourceLoadingSystem - The system for loading resources.
 * @returns A promise that resolves to an object containing key entity IDs.
 */
export async function createScene(
  world: World,
  resourceLoadingSystem: ResourceLoadingSystem,
): Promise<{
  cameraEntity: number;
  playerEntity: number;
}> {
  // --- Environment & Skybox ---
  const iblHandle = ResourceHandle.create(
    ResourceType.EnvironmentMap,
    "/assets/hdris/citrus_orchard_road_puresky_4k.hdr",
  );
  const iblEntity = world.createEntity("ibl_resource");
  world.addComponent(
    iblEntity,
    new IBLResourceComponent(iblHandle, iblHandle.key, 1024),
  );

  // --- Pre-load Projectile Assets ---
  const projectileMeshHandle = ResourceHandle.forMesh(
    "PRIM:icosphere:r=0.1,sub=1",
  );
  await resourceLoadingSystem.loadByHandle(world, projectileMeshHandle);

  const projectileMaterialSpec: PBRMaterialSpec = {
    type: "PBR",
    options: {
      emissive: [1.0, 0.5, 0.1],
      emissiveStrength: 2.0,
      albedo: [1.0, 0.5, 0.1, 1.0],
    },
  };
  // Create an entity to declare this material needs to be loaded.
  const projectileMatEntity = world.createEntity(
    "projectile_material_resource",
  );
  world.addComponent(
    projectileMatEntity,
    new PBRMaterialSpecComponent(projectileMaterialSpec),
  );
  world.addComponent(projectileMatEntity, new MaterialResourceComponent());
  await resourceLoadingSystem.loadMaterial(world, projectileMaterialSpec);

  // --- Player ---
  const initialPlayerTransform = new TransformComponent();
  initialPlayerTransform.setPosition(0, 1, 10);
  const playerEntity = createPlayerPrefab(world, initialPlayerTransform);

  // --- Camera ---
  const cameraEntity = world.createEntity("main_camera");
  world.addComponent(
    cameraEntity,
    new CameraComponent(45, 16 / 9, 0.1, 1000.0),
  );
  world.addComponent(cameraEntity, new MainCameraTagComponent());
  world.addComponent(cameraEntity, new TransformComponent());
  world.addComponent(
    cameraEntity,
    new CameraFollowComponent(playerEntity, vec3.create(0, 1.6, 0)),
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
  fog.density = 0.005;
  fog.height = -5.0;
  fog.heightFalloff = 0.01;
  fog.inscatteringIntensity = 4.0;
  world.addResource(fog);

  // --- Ground Plane ---
  const groundEntity = world.createEntity("ground_plane");
  const groundEntityTransform = new TransformComponent();
  groundEntityTransform.setPosition(0, 0, 0);
  world.addComponent(groundEntity, groundEntityTransform);

  const groundMeshHandle = ResourceHandle.forMesh("PRIM:plane:size=200");
  const groundMaterialSpec: PBRMaterialSpec = {
    type: "PBR",
    options: {
      albedoMap: "/assets/textures/snow_02_4k/textures/snow_02_diff_4k.jpg",
      normalMap: "/assets/textures/snow_02_4k/textures/snow_02_nor_gl_4k.jpg",
      metallicRoughnessMap:
        "/assets/textures/snow_02_4k/textures/snow_02_rough_4k.jpg",
      metallic: 0.0,
      uvScale: [5, 5],
      samplerAddressModeU: "repeat",
      samplerAddressModeV: "repeat",
    },
  };
  const groundMaterialKey = createMaterialSpecKey(groundMaterialSpec);
  const groundMaterialHandle = ResourceHandle.forMaterial(groundMaterialKey);

  world.addComponent(
    groundEntity,
    new MeshRendererComponent(groundMeshHandle, groundMaterialHandle),
  );
  world.addComponent(groundEntity, new MeshResourceComponent(groundMeshHandle));
  const groundMatEntity = world.createEntity("ground_material_resource");
  world.addComponent(
    groundMatEntity,
    new PBRMaterialSpecComponent(groundMaterialSpec),
  );
  world.addComponent(groundMatEntity, new MaterialResourceComponent());

  world.addComponent(groundEntity, new PhysicsBodyComponent("fixed"));
  world.addComponent(
    groundEntity,
    new PhysicsColliderComponent(1, [100, 0.001, 100]),
  );

  // --- Global Sun and Shadow Settings ---
  world.addResource(new SceneSunComponent());
  world.addResource(new ShadowSettingsComponent());

  return { cameraEntity, playerEntity };
}

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
  createPlaneMeshData,
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
import { PlayerControllerComponent } from "@/core/ecs/components/playerControllerComponent";

export async function createDefaultScene(
  world: World,
  resourceManager: ResourceManager,
): Promise<{
  cameraEntity: number;
  demoModelEntity: number;
  playerEntity: number;
  keyLightEntity: number;
  fillLightEntity: number;
  rimLightEntity: number;
}> {
  // Environment
  const envMap = await resourceManager.createEnvironmentMap(
    "/assets/hdris/lonely_road_afternoon_puresky_4k.hdr",
    1024,
  );
  world.addResource(new SkyboxComponent(envMap.skyboxMaterial));
  world.addResource(envMap.iblComponent);

  // Camera
  const cameraEntity = world.createEntity("main_camera");
  {
    const t = new TransformComponent();
    const eye = vec3.fromValues(26, 12, 26);
    const target = vec3.fromValues(0, 0, 0);
    const up = vec3.fromValues(0, 1, 0);
    const view = mat4.lookAt(eye, target, up);
    const worldFromView = mat4.invert(view);
    t.setRotation(quat.fromMat(worldFromView));
    world.addComponent(cameraEntity, t);
    world.addComponent(
      cameraEntity,
      new CameraComponent(45, 16 / 9, 0.1, 1000),
    );
    world.addComponent(cameraEntity, new MainCameraTagComponent());
  }

  // Subtle fog for depth
  {
    const fog = new FogComponent();
    fog.color.set([0.12, 0.14, 0.16, 1.0]);
    fog.density = 0.05;
    fog.height = -2.0;
    fog.heightFalloff = 0.025;
    fog.inscatteringIntensity = 2.2;
    world.addResource(fog);
  }

  // Ground: visual plane + static box collider
  {
    const ground = world.createEntity("ground");
    const gt = new TransformComponent();
    gt.setPosition(0, 0, 0);
    gt.setScale(140, 0.1, 140);
    world.addComponent(ground, gt);

    // physics: A fixed body does not move.
    world.addComponent(ground, new PhysicsBodyComponent("fixed"));
    // Use a thin but non-zero box for the ground collider for stability.
    world.addComponent(ground, new PhysicsColliderComponent(1, [70, 0.05, 70]));

    // visual
    const groundMat = await resourceManager.createUnlitGroundMaterial({
      color: [0.16, 0.16, 0.16, 1],
      // temporarily directly using diff texture
      // todo: gltf, diff, spec, norm etc texture loading
      textureUrl:
        "/assets/textures/rocky_terrain_02_4k/textures/rocky_terrain_02_diff_4k.jpg",
    });
    const groundMesh = await resourceManager.createMesh(
      "plane_ground",
      createPlaneMeshData(1),
    );
    world.addComponent(
      ground,
      new MeshRendererComponent(groundMesh, groundMat),
    );
  }

  // Player entity (invisible capsule)
  const playerEntity = world.createEntity("player");
  {
    const t = new TransformComponent();
    t.setPosition(0, 1, 20); // Start on ground, away from pyramid
    world.addComponent(playerEntity, t);

    // Physics: kinematic capsule, marked as player
    const bodyComp = new PhysicsBodyComponent("kinematicPosition", true);
    world.addComponent(playerEntity, bodyComp);
    const colliderComp = new PhysicsColliderComponent();
    colliderComp.setCapsule(0.4, 0.9); // Slim FPS capsule
    world.addComponent(playerEntity, colliderComp);

    // Controller
    const playerComp = new PlayerControllerComponent();
    playerComp.jumpForce = 7.5;
    world.addComponent(playerEntity, playerComp);

    // No visual mesh (invisible player)
    console.log(
      "[Scene] Player entity created at (0,1,5) with kinematic capsule.",
    );
  }

  // Materials reused
  const cubeMatOptionsA = {
    albedo: [0.85, 0.45, 0.35, 1] as [number, number, number, number],
    metallic: 0.05,
    roughness: 0.65,
  };
  const cubeMatOptionsB = {
    albedo: [0.35, 0.6, 0.9, 1] as [number, number, number, number],
    metallic: 0.25,
    roughness: 0.5,
  };
  const cubeTplA =
    await resourceManager.createPBRMaterialTemplate(cubeMatOptionsA);
  const cubeTplB =
    await resourceManager.createPBRMaterialTemplate(cubeMatOptionsB);
  const cubeInstA = await resourceManager.createPBRMaterialInstance(
    cubeTplA,
    cubeMatOptionsA,
  );
  const cubeInstB = await resourceManager.createPBRMaterialInstance(
    cubeTplB,
    cubeMatOptionsB,
  );
  const cubeMesh = await resourceManager.createMesh(
    "unit_cube_1m",
    createCubeMeshData(1),
  );

  // 3D cube pyramid (N=5 layers: 25 + 16 + 9 + 4 + 1 = 55 dynamic cubes)
  {
    const LAYERS = 5;
    const GROUND_Y_TOP = 0.5;
    const HALF = 0.5; // half extents of unit cube
    const START_Y = GROUND_Y_TOP + HALF; // Place bottom of cube on ground
    for (let layer = 0; layer < LAYERS; layer++) {
      const count = LAYERS - layer;
      const base = -((count - 1) * 1.0) / 2; // center the row in X and Z
      for (let ix = 0; ix < count; ix++) {
        for (let iz = 0; iz < count; iz++) {
          const e = world.createEntity(`p_cube_${layer}_${ix}_${iz}`);
          const t = new TransformComponent();
          const x = base + ix * 1.0;
          const z = base + iz * 1.0;
          const y = START_Y + layer * (1.0 + 0.001); // small separation
          t.setPosition(x, y, z);
          t.setScale(1, 1, 1);
          world.addComponent(e, t);

          // alternate materials for visual interest
          const inst = (ix + iz + layer) % 2 === 0 ? cubeInstA : cubeInstB;
          world.addComponent(e, new MeshRendererComponent(cubeMesh, inst));

          // physics: dynamic box
          world.addComponent(e, new PhysicsBodyComponent("dynamic"));
          world.addComponent(
            e,
            new PhysicsColliderComponent(1, [HALF, HALF, HALF]),
          );
        }
      }
    }
  }

  // Shooter ball (dynamic sphere) placed on ramp to roll into pyramid
  const demoModelEntity = world.createEntity("shooter_ball");
  {
    const t = new TransformComponent();
    const GROUND_Y_TOP = 0.0;
    const BALL_RADIUS = 1.0;
    t.setPosition(-8, GROUND_Y_TOP + BALL_RADIUS, 0); // position near the pyramid, resting on ground
    t.setScale(1, 1, 1);
    world.addComponent(demoModelEntity, t);

    const ballOpts = {
      albedo: [0.95, 0.8, 0.35, 1] as [number, number, number, number],
      metallic: 0.0,
      roughness: 0.25,
    };
    const ballTpl = await resourceManager.createPBRMaterialTemplate(ballOpts);
    const ballInst = await resourceManager.createPBRMaterialInstance(
      ballTpl,
      ballOpts,
    );
    const ballMesh = await resourceManager.createMesh(
      "ball_mesh",
      createIcosphereMeshData(1.0, 3),
    );
    world.addComponent(
      demoModelEntity,
      new MeshRendererComponent(ballMesh, ballInst),
    );

    // physics: dynamic sphere r=1
    world.addComponent(demoModelEntity, new PhysicsBodyComponent("dynamic"));
    world.addComponent(
      demoModelEntity,
      new PhysicsColliderComponent(0, [1, 0, 0]),
    );
  }

  // Shared light indicator mesh and emissive materials
  const lightMesh = await resourceManager.createMesh(
    "light_indicator_sphere",
    createIcosphereMeshData(0.4, 2),
  );

  // Warm (key), Cool (fill), Neutral (rim) emissive materials
  const warmMat = await resourceManager.createPBRMaterialInstance(
    await resourceManager.createPBRMaterialTemplate({
      albedo: [1, 0.8, 0.6, 1],
      emissive: [1, 0.8, 0.6],
      roughness: 0.9,
      metallic: 0.0,
    }),
    {
      albedo: [1, 0.8, 0.6, 1],
      emissive: [1, 0.8, 0.6],
      roughness: 0.9,
      metallic: 0.0,
    },
  );

  const coolMat = await resourceManager.createPBRMaterialInstance(
    await resourceManager.createPBRMaterialTemplate({
      albedo: [0.6, 0.8, 1, 1],
      emissive: [0.6, 0.8, 1],
      roughness: 0.9,
      metallic: 0.0,
    }),
    {
      albedo: [0.6, 0.8, 1, 1],
      emissive: [0.6, 0.8, 1],
      roughness: 0.9,
      metallic: 0.0,
    },
  );

  const whiteMat = await resourceManager.createPBRMaterialInstance(
    await resourceManager.createPBRMaterialTemplate({
      albedo: [1, 1, 1, 1],
      emissive: [1, 1, 1],
      roughness: 0.9,
      metallic: 0.0,
    }),
    {
      albedo: [1, 1, 1, 1],
      emissive: [1, 1, 1],
      roughness: 0.9,
      metallic: 0.0,
    },
  );

  // Lights: key, fill, rim
  const keyLightEntity = world.createEntity("key_light");
  {
    const t = new TransformComponent();
    t.setPosition(18, 10, 18);
    world.addComponent(keyLightEntity, t);
    world.addComponent(
      keyLightEntity,
      new LightComponent([1.0, 0.92, 0.78, 1], [0, 0, 0, 1], 42.0, 7.0),
    );
    world.addComponent(
      keyLightEntity,
      new MeshRendererComponent(lightMesh, warmMat),
    );
  }

  const fillLightEntity = world.createEntity("fill_light");
  {
    const t = new TransformComponent();
    t.setPosition(-22, 8, 14);
    world.addComponent(fillLightEntity, t);
    world.addComponent(
      fillLightEntity,
      new LightComponent([0.65, 0.8, 1.0, 1], [0, 0, 0, 1], 30.0, 4.0),
    );
    world.addComponent(
      fillLightEntity,
      new MeshRendererComponent(lightMesh, coolMat),
    );
  }

  const rimLightEntity = world.createEntity("rim_light");
  {
    const t = new TransformComponent();
    t.setPosition(0, 9, -24);
    world.addComponent(rimLightEntity, t);
    world.addComponent(
      rimLightEntity,
      new LightComponent([1.0, 1.0, 1.0, 1], [0, 0, 0, 1], 24.0, 5.0),
    );
    world.addComponent(
      rimLightEntity,
      new MeshRendererComponent(lightMesh, whiteMat),
    );
  }

  // Sun + shadow resources (editor widgets will control)
  world.addResource(new SceneSunComponent());
  world.addResource(new ShadowSettingsComponent());

  return {
    cameraEntity,
    demoModelEntity,
    playerEntity,
    keyLightEntity,
    fillLightEntity,
    rimLightEntity,
  };
}

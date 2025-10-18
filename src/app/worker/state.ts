// src/app/worker/state.ts
import { Renderer } from "@/core/rendering/renderer";
import { ResourceManager } from "@/core/resources/resourceManager";
import { World } from "@/core/ecs/world";
import { SceneRenderData } from "@/core/types/rendering";
import { CameraControllerSystem } from "@/core/ecs/systems/cameraControllerSystem";
import { PlayerControllerSystem } from "@/core/ecs/systems/playerControllerSystem";
import { WeaponSystem } from "@/core/ecs/systems/weaponSystem";
import { DamageSystem } from "@/core/ecs/systems/damageSystem";
import { CollisionEventSystem } from "@/core/ecs/systems/collisionEventSystem";
import { DeathSystem } from "@/core/ecs/systems/deathSystem";
import { InteractionSystem } from "@/core/ecs/systems/interactionSystem";
import { PickupSystem } from "@/core/ecs/systems/pickupSystem";
import { InventorySystem } from "@/core/ecs/systems/inventorySystem";
import { RespawnSystem } from "@/core/ecs/systems/respawnSystem";
import { PhysicsCommandSystem } from "@/core/ecs/systems/physicsCommandSystem";
import { InputContext } from "@/core/input/manager";
import { MetricsContext } from "@/core/metrics";
import { EngineStateContext } from "@/core/engineState";
import { PhysicsContext } from "@/core/physicsState";
import { IActionController } from "@/core/input/action";
import { IInputSource } from "@/core/input/iinputSource";
import { EventManager } from "@/core/ecs/events/eventManager";
import { PrefabFactory } from "@/app/prefabs";
import { ActionMapConfig, ActionStateMap } from "@/core/input/action";
import { ProjectileSystem } from "@/core/ecs/systems/projectileSystem";

/**
 * Shared state for the render worker.
 *
 * Centralizes all worker-scoped state including contexts, systems,
 * and runtime variables to avoid global variable sprawl.
 */
export interface WorkerState {
  // Core systems
  renderer: Renderer | null;
  resourceManager: ResourceManager | null;
  world: World | null;
  sceneRenderData: SceneRenderData | null;
  eventManager: EventManager | null;

  // Camera and player
  cameraEntity: number;
  cameraControllerSystem: CameraControllerSystem | null;
  playerControllerSystem: PlayerControllerSystem | null;
  isFreeCameraActive: boolean;

  // Input
  inputContext: InputContext | null;
  inputReader: IInputSource | null;
  actionController: IActionController | null;
  actionMap: ActionMapConfig | null;
  previousActionState: ActionStateMap;

  // Game systems
  damageSystem: DamageSystem | null;
  collisionEventSystem: CollisionEventSystem | null;
  deathSystem: DeathSystem | null;
  projectileSystem: ProjectileSystem | null;
  weaponSystem: WeaponSystem | null;
  interactionSystem: InteractionSystem | null;
  pickupSystem: PickupSystem | null;
  inventorySystem: InventorySystem | null;
  respawnSystem: RespawnSystem | null;
  physicsCommandSystem: PhysicsCommandSystem | null;
  prefabFactory: PrefabFactory | null;

  // Shared contexts
  metricsContext: MetricsContext | null;
  engineStateCtx: EngineStateContext | null;
  physicsCtx: PhysicsContext | null;
  raycastResultsCtx: { i32: Int32Array; f32: Float32Array } | null;
  interactionRaycastResultsCtx: { i32: Int32Array } | null;

  // Physics worker
  physicsWorker: Worker | null;
  lastSnapshotGen: number;

  // Runtime state
  lastViewportWidth: number;
  lastViewportHeight: number;
  lastFrameTime: number;
  metricsFrameId: number;
}

/**
 * Global worker state instance.
 *
 * All modules import and modify this single state object
 * to maintain consistency across the worker.
 */
export const state: WorkerState = {
  renderer: null,
  resourceManager: null,
  world: null,
  sceneRenderData: null,
  eventManager: null,
  cameraEntity: -1,
  cameraControllerSystem: null,
  playerControllerSystem: null,
  isFreeCameraActive: false,
  inputContext: null,
  inputReader: null,
  actionController: null,
  actionMap: null,
  previousActionState: new Map(),
  damageSystem: null,
  collisionEventSystem: null,
  deathSystem: null,
  projectileSystem: null,
  weaponSystem: null,
  interactionSystem: null,
  pickupSystem: null,
  inventorySystem: null,
  respawnSystem: null,
  physicsCommandSystem: null,
  prefabFactory: null,
  metricsContext: null,
  engineStateCtx: null,
  physicsCtx: null,
  raycastResultsCtx: null,
  interactionRaycastResultsCtx: null,
  physicsWorker: null,
  lastSnapshotGen: 0,
  lastViewportWidth: 0,
  lastViewportHeight: 0,
  lastFrameTime: 0,
  metricsFrameId: 0,
};

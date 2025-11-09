// src/client/runtime/state.ts
import { Renderer } from "@/client/rendering/renderer";
import { World } from "@/shared/ecs/world";
import { SceneRenderData } from "@/client/types/rendering";
import { CameraControllerSystem } from "@/shared/ecs/systems/clientOnly/cameraControllerSystem";
import { PlayerControllerSystem } from "@/shared/ecs/systems/playerControllerSystem";
import { WeaponSystem } from "@/shared/ecs/systems/shared/weaponSystem";
import { DamageSystem } from "@/shared/ecs/systems/shared/damageSystem";
import { CollisionEventSystem } from "@/shared/ecs/systems/shared/collisionEventSystem";
import { DeathSystem } from "@/shared/ecs/systems/shared/deathSystem";
import { InteractionSystem } from "@/shared/ecs/systems/shared/interactionSystem";
import { PickupSystem } from "@/shared/ecs/systems/shared/pickupSystem";
import { InventorySystem } from "@/shared/ecs/systems/shared/inventorySystem";
import { RespawnSystem } from "@/shared/ecs/systems/serverOnly/respawnSystem";
import { PhysicsCommandSystem } from "@/shared/ecs/systems/serverOnly/physicsCommandSystem";
import { InputContext } from "@/client/input/manager";
import { EngineStateContext } from "@/shared/state/engineState";
import { PhysicsContext } from "@/shared/state/physicsState";
import { EventManager } from "@/shared/ecs/events/eventManager";
import { PrefabFactory } from "@/shared/game/prefabs";
import { ProjectileSystem } from "@/shared/ecs/systems/shared/projectileSystem";
import { ResourceLoadingSystem } from "@/shared/ecs/systems/clientOnly/ressources/resourceLoadingSystem";
import { UIRenderSystem } from "@/shared/ecs/systems/clientOnly/ui/uiRenderSystem";
import { IBLIntegrationSystem } from "@/shared/ecs/systems/clientOnly/ressources/iblIntegrationSystem";
import { RawInputSystem } from "@/shared/ecs/systems/clientOnly/input/rawInputSystem";
import { InputToActionSystem } from "@/shared/ecs/systems/clientOnly/input/inputToActionSystem";

/**
 * Shared state for the render worker.
 *
 * Centralizes all worker-scoped state including contexts, systems,
 * and runtime variables to avoid global variable sprawl.
 */
export interface WorkerState {
  // Core systems
  renderer: Renderer | null;
  resourceLoadingSystem: ResourceLoadingSystem | null;
  iblIntegrationSystem: IBLIntegrationSystem | null;
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
  rawInputSystem: RawInputSystem | null;
  inputToActionSystem: InputToActionSystem | null;

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
  uiRenderSystem: UIRenderSystem | null;

  // Shared contexts
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
  isBusy: boolean;
}

/**
 * Global worker state instance.
 *
 * All modules import and modify this single state object
 * to maintain consistency across the worker.
 */
export const state: WorkerState = {
  renderer: null,
  resourceLoadingSystem: null,
  iblIntegrationSystem: null,
  world: null,
  sceneRenderData: null,
  eventManager: null,
  cameraEntity: -1,
  cameraControllerSystem: null,
  playerControllerSystem: null,
  isFreeCameraActive: false,
  inputContext: null,
  rawInputSystem: null,
  inputToActionSystem: null,
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
  uiRenderSystem: null,
  engineStateCtx: null,
  physicsCtx: null,
  raycastResultsCtx: null,
  interactionRaycastResultsCtx: null,
  physicsWorker: null,
  lastSnapshotGen: 0,
  lastViewportWidth: 0,
  lastViewportHeight: 0,
  lastFrameTime: 0,
  isBusy: false,
};

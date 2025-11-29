// src/server/game/gameInstance.ts
import { World } from "@/shared/ecs/world";
import { PhysicsHost } from "@/server/physics/physicsHost";
import { PlayerMovementSystem } from "@/server/game/systems/playerMovementSystem";
import { PhysicsCommandSystem } from "@/shared/ecs/systems/serverOnly/physicsCommandSystem";
import { transformSystem } from "@/shared/ecs/systems/shared/transformSystem";
import { PlayerInputMessage } from "@/shared/network/protocol";
import { ClientId } from "@/shared/network/protocol";
import { Entity } from "@/shared/ecs/entity";
import { TransformComponent } from "@/shared/ecs/components/gameplay/transformComponent";
import { PhysicsBodyComponent, PhysicsColliderComponent } from "@/shared/ecs/components/physics/physicsComponents";
import { PlayerControllerComponent } from "@/shared/ecs/components/gameplay/playerControllerComponent";
import { NetworkIdComponent } from "@/shared/ecs/components/networked/networkId";
import { HealthComponent } from "@/shared/ecs/components/gameplay/healthComponent";
import { WeaponComponent } from "@/shared/ecs/components/gameplay/weaponComponent";

/** 
 * Acts as the "World" container for a single match. 
 **/
export class GameInstance {
  public readonly id: string;
  public readonly world: World;
  
  private physicsHost: PhysicsHost;
  
  // Systems
  private playerMovementSystem: PlayerMovementSystem;
  private physicsCommandSystem: PhysicsCommandSystem;

  // State
  private pendingInputs = new Map<ClientId, PlayerInputMessage[]>();
  private clientToEntity = new Map<ClientId, Entity>();
  private nextNetId = 1000; // Start IDs higher to reserve space for static map objects

  constructor(id: string) {
    this.id = id;
    this.world = new World();

    console.log(`[GameInstance:${id}] Initializing physics...`);
    this.physicsHost = new PhysicsHost();

    // Initialize Systems
    // 1. Movement System: Applies inputs to authoritative transforms
    this.playerMovementSystem = new PlayerMovementSystem(this.physicsHost.context);
    
    // 2. Physics Command System: Syncs ECS changes to Physics Worker (SAB)
    this.physicsCommandSystem = new PhysicsCommandSystem(this.physicsHost.context);

    // TODO: Initialize other systems (Damage, Weapon, etc.)
  }

  public addPlayer(clientId: ClientId) {
    this.pendingInputs.set(clientId, []);
    
    // Spawn the server-side player entity
    const playerEntity = this.spawnPlayerEntity(clientId);
    this.clientToEntity.set(clientId, playerEntity);
    
    console.log(`[GameInstance:${this.id}] Player ${clientId} added. Entity ID: ${playerEntity}`);
  }

  public removePlayer(clientId: ClientId) {
    const entity = this.clientToEntity.get(clientId);
    if (entity !== undefined) {
      // Clean up the entity from the world
      this.world.destroyEntity(entity);
      this.clientToEntity.delete(clientId);
    }
    this.pendingInputs.delete(clientId);
    console.log(`[GameInstance:${this.id}] Player ${clientId} removed.`);
  }

  /**
   * Spawns the authoritative player entity with all required server components.
   * This mirrors the "Prefab" logic but specific to the server's needs (no visuals).
   */
  private spawnPlayerEntity(clientId: ClientId): Entity {
    const entity = this.world.createEntity();

    // 1. Transform
    const transform = new TransformComponent();
    transform.setPosition(0, 10, 0); // Default spawn location
    this.world.addComponent(entity, transform);

    // 2. Physics
    const bodyComp = new PhysicsBodyComponent("kinematicPosition", true);
    // Use the entity ID as the physics ID
    bodyComp.physId = entity; 
    this.world.addComponent(entity, bodyComp);

    const colliderComp = new PhysicsColliderComponent();
    colliderComp.setCapsule(0.4, 0.9); // radius 0.4, half-height 0.9
    this.world.addComponent(entity, colliderComp);

    // 3. Gameplay Logic
    const controller = new PlayerControllerComponent();
    this.world.addComponent(entity, controller);

    this.world.addComponent(entity, new HealthComponent(100));
    
    // 4. Weapon
    const weapon = new WeaponComponent();
    weapon.fireRate = 10.0;
    weapon.damage = 10.0;
    this.world.addComponent(entity, weapon);

    // 5. Network Identity
    const netId = new NetworkIdComponent();
    netId.netId = this.nextNetId++;
    netId.ownerId = clientId;
    netId.replicateTo = 'all';
    this.world.addComponent(entity, netId);

    return entity;
  }

  /**
   * Queue input from the network to be processed in the next tick.
   */
  public queueInput(clientId: ClientId, input: PlayerInputMessage) {
    const queue = this.pendingInputs.get(clientId);
    if (queue) {
      queue.push(input);
    }
  }

  /**
   * Main Simulation Step
   * @param dt Delta time in seconds
   */
  public tick(dt: number) {
    // 1. Process Inputs
    this.pendingInputs.forEach((inputs, clientId) => {
        const playerEntity = this.clientToEntity.get(clientId);
        
        if (playerEntity !== undefined) {
            // Apply all pending inputs for this frame in order
            for (const input of inputs) {
               this.playerMovementSystem.applyInput(this.world, playerEntity, input);
            }
        }
        
        // Clear processed inputs for next frame
        inputs.length = 0;
    });

    // 2. Physics Command Sync
    // Detects changes in ECS (like new bodies) and writes to Command Ring Buffer
    this.physicsCommandSystem.update(this.world);

    // 3. Step Physics
    this.physicsHost.worker.postMessage({ type: "STEP", steps: 1 });

    // 4. Update Transforms (Hierarchy)
    // Ensures parent/child relationships are resolved before snapshotting
    transformSystem(this.world);

    // 5. TODO: Broadcast Snapshots (SnapshotSystem)
  }

  public async shutdown() {
    await this.physicsHost.terminate();
  }
}
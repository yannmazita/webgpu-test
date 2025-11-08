// src/shared/ecs/components/physicsComponents.ts
import { IComponent } from "../component";
import { Vec3, vec3 } from "wgpu-matrix";

export type PhysicsBodyType =
  | "dynamic"
  | "fixed"
  | "kinematicPosition"
  | "kinematicVelocity";

/**
 * Component marking an entity with a physics body in Rapier.
 *
 * This component links an ECS entity to a corresponding rigid body in the
 * physics simulation. It is added during scene authoring or runtime spawning.
 * The PHYS_ID is set by the PhysicsCommandSystem upon enqueueing a CREATE_BODY
 * command and mirrors the entity ID for simplicity.
 *
 * Usage:
 * - Attach to any entity needing physics (like dynamic objects, static obstacles).
 * - Pair with PhysicsColliderComponent for collision shapes.
 * - The physics worker creates the actual Rapier body asynchronously via SAB.
 */
export class PhysicsBodyComponent implements IComponent {
  /**
   * Unique physics body ID (mirrors entity ID; set by command system).
   *
   * This ID is used to match ECS entities with Rapier bodies in snapshots.
   * Initially 0; assigned optimistically during CREATE enqueue.
   */
  public physId = 0;

  /**
   * Type of rigid body: 'dynamic' (simulated), 'fixed' (static), 'kinematicPosition' (position-controlled, for characters),
   * or 'kinematicVelocity' (velocity-controlled).
   *
   * Defaults to 'dynamic'. For FPS player, use 'kinematicPosition'.
   */
  public bodyType: PhysicsBodyType = "dynamic";

  /**
   * True if this is the player entity (for special handling like character controller).
   * Single-player only; set during entity creation.
   */
  public isPlayer = false;

  /** Optional initial linear velocity to apply when the body is created. */
  public initialVelocity: Vec3 | null = null;

  /**
   * Constructs a PhysicsBodyComponent.
   *
   * @param bodyType The body type (default: 'dynamic').
   * @param isPlayer True if player (default: false).
   * @param initialVelocity Optional initial velocity.
   */
  constructor(
    bodyType: PhysicsBodyType = "dynamic",
    isPlayer = false,
    initialVelocity: Vec3 | null = null,
  ) {
    this.bodyType = bodyType;
    this.isPlayer = isPlayer;
    this.initialVelocity = initialVelocity;
  }
}

/**
 * Component defining collider shape and properties for a physics body.
 *
 * This component specifies the collision geometry attached to a PhysicsBodyComponent.
 * Supports basic primitives: sphere, box, capsule. Parameters are packed into
 * a fixed Float32Array for SAB transmission.
 *
 * Usage:
 * - Set type and params before adding to entity.
 * - Multiple colliders per body possible (add multiple components; future extension).
 * - Defaults to sphere (radius=1); clamp values to avoid invalid shapes.
 */
export class PhysicsColliderComponent implements IComponent {
  /**
   * Shape type: 0=sphere (params: [radius]), 1=box (params: [hx, hy, hz]),
   * 2=capsule (params: [radius, halfHeight]).
   *
   * Determines how params array is interpreted.
   */
  public type: 0 | 1 | 2 = 0;

  /**
   * Type-specific parameters (up to 3 floats; extras ignored).
   *
   * - Sphere (0): [radius, 0, 0]
   * - Box (1): [halfExtentX, halfExtentY, halfExtentZ]
   * - Capsule (2): [radius, halfHeight, 0]
   *
   * Values are clamped on set (min 0.001 to avoid degenerate shapes).
   */
  public params: Float32Array = new Float32Array(3);

  /**
   * Constructs a PhysicsColliderComponent.
   *
   * Initializes with a default sphere (type=0, params=[1,1,1] clamped appropriately).
   *
   * @param type Initial shape type (default: 0 for sphere).
   * @param params Initial parameters as Vec3 or number[] (default: [1,1,1]).
   */
  constructor(type: 0 | 1 | 2 = 0, params: Vec3 | number[] = [1, 1, 1]) {
    this.type = type;
    if (Array.isArray(params)) {
      vec3.set(params[0] ?? 0, params[1] ?? 0, params[2] ?? 0, this.params);
    } else {
      vec3.copy(params, this.params);
    }
    // Normalize params based on type (like sphere uses only [0])
    if (type === 0) {
      // sphere: radius only
      this.params[1] = 0;
      this.params[2] = 0;
    } else if (type === 2) {
      // capsule: radius, half-height, 0
      this.params[2] = 0;
    }
  }

  /**
   * Sets sphere collider (radius).
   *
   * Updates type=0 and params[0]=radius (clamped >=0.001).
   * Sets params[1]=params[2]=0.
   *
   * @param radius Sphere radius (must be positive).
   */
  public setSphere(radius: number): void {
    this.type = 0;
    this.params[0] = Math.max(0.001, radius);
    this.params[1] = 0;
    this.params[2] = 0;
  }

  /**
   * Sets box collider (half-extents).
   *
   * Updates type=1 and copies halfExtents to params (clamped >=0.001 per axis).
   *
   * @param halfExtents Half-extents along X/Y/Z (all must be positive).
   */
  public setBox(halfExtents: Vec3): void {
    this.type = 1;
    vec3.copy(halfExtents, this.params);
    // Manual clamp per component (min 0.001)
    for (let i = 0; i < 3; i++) {
      this.params[i] = Math.max(0.001, this.params[i]);
    }
  }

  /**
   * Sets capsule collider (radius, half-height).
   *
   * Updates type=2, params[0]=radius (>=0.001), params[1]=halfHeight (>=0.001), params[2]=0.
   *
   * @param radius Capsule radius (must be positive).
   * @param halfHeight Half-length along Y-axis (must be positive).
   */
  public setCapsule(radius: number, halfHeight: number): void {
    this.type = 2;
    this.params[0] = Math.max(0.001, radius); // [0]: radius (for worker swap to Rapier capsule(halfHeight, radius))
    this.params[1] = Math.max(0.001, halfHeight); // [1]: halfHeight
    this.params[2] = 0;
  }
}

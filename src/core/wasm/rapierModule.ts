// src/core/wasm/rapierModule.ts

/**
 * Centralized Rapier3D WASM module loader.
 *
 * This module handles the dynamic import and initialization of the Rapier3D
 * physics library. It provides a singleton pattern for loading the WASM module
 * and factory functions for creating physics world instances.
 *
 * The module does NOT own any instances from Rapier (ie Word) - those are managed by consumers
 * (ie the physics worker).
 */

export type RAPIER = typeof import("@dimforge/rapier3d");
export type World = import("@dimforge/rapier3d").World;
export type RigidBodyDesc = import("@dimforge/rapier3d").RigidBodyDesc;
export type RigidBody = import("@dimforge/rapier3d").RigidBody;
export type ColliderDesc = import("@dimforge/rapier3d").ColliderDesc;
export type Collider = import("@dimforge/rapier3d").Collider;
export type IntegrationParameters =
  import("@dimforge/rapier3d").IntegrationParameters;
export type KinematicCharacterController =
  import("@dimforge/rapier3d").KinematicCharacterController;

let RAPIER: RAPIER | null = null;
let rapierPromise: Promise<void> | null = null;

/**
 * Initializes the Rapier3D physics WASM module.
 *
 * @remarks
 * This function handles the dynamic import of the Rapier3D library. It follows
 * a lazy-loading and idempotent pattern: the first time it is called, it
 * performs the initialization and stores a promise. Subsequent calls will
 * return the same promise without re-initializing.
 *
 * This function must be successfully awaited before creating a physics world or
 * accessing any Rapier APIs.
 *
 * @returns A promise that resolves when the module is ready for use.
 * @throws Error if initialization fails
 */
export async function initRapier(): Promise<void> {
  if (rapierPromise) return rapierPromise;

  console.log("[RapierModule] Starting Rapier initialization...");

  rapierPromise = (async () => {
    try {
      const start = performance.now();
      const r = await import("@dimforge/rapier3d");
      RAPIER = r;
      const loadTime = performance.now() - start;
      console.log(`[RapierModule] Rapier loaded in ${loadTime.toFixed(2)}ms`);
    } catch (error) {
      console.error("[RapierModule] Initialization failed:", error);
      RAPIER = null;
      rapierPromise = null; // Allow retry on failure
      throw error;
    }
  })();

  return rapierPromise;
}

/**
 * Returns the initialized Rapier3D module.
 *
 * @returns The Rapier module, or null if not yet initialized
 */
export function getRapierModule(): RAPIER | null {
  return RAPIER;
}

/**
 * Creates a new Rapier physics world with the specified configuration.
 *
 * @param gravity - The gravity vector to apply to the world
 * @param fixedDt - The fixed timestep for integration (e.g., 1/60 for 60Hz)
 * @returns A configured World instance
 * @throws Error if Rapier module is not initialized
 */
export function createWorld(
  gravity: { x: number; y: number; z: number },
  fixedDt: number,
): World {
  if (!RAPIER) {
    throw new Error(
      "[RapierModule] Cannot create world: Rapier not initialized. Call initRapier() first.",
    );
  }

  const world = new RAPIER.World(gravity);
  const params: IntegrationParameters = world.integrationParameters;
  params.dt = fixedDt;

  console.log(
    `[RapierModule] World created. Gravity: (${gravity.x}, ${gravity.y}, ${gravity.z}), dt: ${fixedDt}`,
  );

  return world;
}

/**
 * Checks if the Rapier module has been successfully initialized.
 *
 * @returns true if the module is ready for use
 */
export function isRapierReady(): boolean {
  return RAPIER !== null;
}

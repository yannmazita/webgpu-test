// src/core/wasm/meshoptimizerModule.ts

/**
 * Centralized meshoptimizer WASM module loader.
 *
 * This module handles the dynamic import and initialization of the meshoptimizer
 * library. It provides a singleton pattern for loading the WASM module.
 *
 */

export type MESHOPT = typeof import("meshoptimizer");
export type MeshoptDecoder = typeof import("meshoptimizer").MeshoptDecoder;

let MESHOPT: MESHOPT | null = null;
let meshoptPromise: Promise<void> | null = null;

/**
 * Initializes the Meshopt decoder WASM module.
 *
 * @remarks
 * This function handles the dynamic import and asynchronous compilation of the
 * meshoptimizer WebAssembly module. It follows a lazy-loading and idempotent
 * pattern: the first time it is called, it performs the initialization and
 * stores a promise. Subsequent calls will return the same promise without
 * re-initializing.
 *
 * This function must be successfully awaited before using the decoder.
 *
 * @returns A promise that resolves when the decoder is ready, or rejects if
 *     initialization fails.
 * @throws Error if initialization fails, allowing the caller to handle it.
 */
export async function initMeshopt(): Promise<void> {
  if (meshoptPromise) return meshoptPromise;

  console.log("[MeshoptModule] Starting meshoptimizer initialization...");

  meshoptPromise = (async () => {
    try {
      const start = performance.now();
      const m = await import("meshoptimizer");
      MESHOPT = m;
      const loadTime = performance.now() - start;
      console.log(
        `[MeshoptModule] Meshoptimizer library loaded in ${loadTime.toFixed(2)}ms`,
      );

      // The decoder class itself has an async `ready` promise
      await MESHOPT.MeshoptDecoder.ready;

      console.log("[MeshoptModule] Meshoptimizer decoder is ready.");
    } catch (error) {
      console.error("[MeshoptModule] Initialization failed:", error);
      MESHOPT = null;
      meshoptPromise = null; // Allow retry on failure
      throw error; // Propagate error to the caller
    }
  })();

  return meshoptPromise;
}

/**
 * Returns the full initialized meshoptimizer module.
 *
 * @returns The meshoptimizer module, or null if not yet initialized.
 */
export function getMeshoptModule(): MESHOPT | null {
  return MESHOPT;
}

/**
 * Returns the initialized MeshoptDecoder class.
 *
 * @returns The MeshoptDecoder class, or null if not ready.
 */
export function getMeshoptDecoder(): MeshoptDecoder | null {
  return MESHOPT?.MeshoptDecoder ?? null;
}

/**
 * Checks if the meshoptimizer module has been successfully initialized.
 *
 * @returns true if the module is ready for use.
 */
export function isMeshoptReady(): boolean {
  return MESHOPT !== null;
}

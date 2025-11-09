// src/shared/wasm/mikktspaceModule.ts

/**
 * Centralized MikkTSpace WASM module loader.
 *
 * This module handles the dynamic import and initialization of the MikkTSpace
 * library, which is used for generating tangent vectors for normal mapping.
 */

export type MikkTSpace = typeof import("mikktspace");

let MIKKTSPACE: MikkTSpace | null = null;
let mikktspacePromise: Promise<void> | null = null;

/**
 * Initializes the MikkTSpace WASM module.
 *
 * @remarks
 * This function handles the dynamic import of the MikkTSpace library.
 * It follows a lazy-loading and idempotent pattern.
 *
 * This function must be successfully awaited before using the library.
 *
 * @returns A promise that resolves when the module is ready, or rejects if
 *     initialization fails.
 * @throws Error if initialization fails or the module format is invalid.
 */
export async function initMikkTSpace(): Promise<void> {
  if (mikktspacePromise) return mikktspacePromise;

  console.log("[MikkTSpaceModule] Starting MikkTSpace initialization...");

  mikktspacePromise = (async () => {
    try {
      const start = performance.now();
      const module = await import("mikktspace");

      // Verify the module loaded correctly by checking for its main export.
      if (typeof module.generateTangents !== "function") {
        throw new Error(
          "MikkTSpace module is invalid or `generateTangents` function not found.",
        );
      }

      MIKKTSPACE = module;
      const loadTime = performance.now() - start;
      console.log(
        `[MikkTSpaceModule] MikkTSpace ready in ${loadTime.toFixed(2)}ms`,
      );
    } catch (error) {
      console.error("[MikkTSpaceModule] Initialization failed:", error);
      MIKKTSPACE = null;
      mikktspacePromise = null; // Allow retry on failure
      throw error; // Propagate error to the caller
    }
  })();

  return mikktspacePromise;
}

/**
 * Returns the full initialized MikkTSpace module.
 *
 * @returns The MikkTSpace module, or null if not yet initialized.
 */
export function getMikkTSpaceModule(): MikkTSpace | null {
  return MIKKTSPACE;
}

/**
 * Checks if the MikkTSpace module has been successfully initialized.
 *
 * @returns true if the module is ready for use.
 */
export function isMikkTSpaceReady(): boolean {
  return MIKKTSPACE !== null;
}

// src/core/wasm/basisModule.ts

/**
 * Centralized Basis Universal WASM module loader.
 *
 * This module handles the dynamic loading and initialization of the Basis
 * transcoder library. It provides a singleton pattern for loading the WASM module.
 *
 */

// These types are from @/core/types/basis.d.ts
export type BasisFile = import("basis-universal").BasisFile;
export type KTX2File = import("basis-universal").KTX2File;
export type BasisTranscoder = typeof import("basis-universal").BasisTranscoder;
export type BasisModule = import("basis-universal").BasisModule;

let BASIS: BasisModule | null = null;
let basisPromise: Promise<void> | null = null;

/**
 * Initializes the Basis Universal transcoder WASM module.
 *
 * @returns A promise that resolves when the transcoder is ready.
 */
export async function initBasis(): Promise<void> {
  if (basisPromise) return basisPromise;

  console.log("[BasisModule] Starting Basis Universal initialization...");

  basisPromise = (async () => {
    try {
      const start = performance.now();

      // Dynamically import the JS wrapper from its new location in src/vendor.
      // The /* @vite-ignore */ comment is no longer needed.
      const { BasisTranscoder } = (await import(
        "../../vendor/basis_transcoder.js"
      )) as { BasisTranscoder: BasisTranscoder };

      const basisModule = {} as BasisModule;

      await new Promise<void>((resolve, reject) => {
        basisModule.onRuntimeInitialized = () => {
          BASIS = basisModule;
          resolve();
        };
        // Tell the transcoder where to find the .wasm file.
        // Since it's in /public, it will be served from the root.
        basisModule.locateFile = (path, prefix) => {
          if (path.endsWith(".wasm")) return "/basis_transcoder.wasm";
          return prefix + path;
        };
        BasisTranscoder(basisModule).catch(reject);
      });

      const loadTime = performance.now() - start;
      console.log(
        `[BasisModule] Basis Universal transcoder loaded in ${loadTime.toFixed(
          2,
        )}ms`,
      );
    } catch (error) {
      console.error("[BasisModule] Initialization failed:", error);
      BASIS = null;
      basisPromise = null;
      throw error;
    }
  })();

  return basisPromise;
}

/**
 * Returns the full initialized Basis Universal module.
 *
 * @returns The Basis module, or null if not yet initialized.
 */
export function getBasisModule(): BasisModule | null {
  return BASIS;
}

/**
 * Checks if the Basis Universal module has been successfully initialized.
 *
 * @returns true if the module is ready for use.
 */
export function isBasisReady(): boolean {
  return BASIS !== null;
}

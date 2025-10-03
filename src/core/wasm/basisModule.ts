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
 * @remarks
 * This function handles the dynamic import and asynchronous compilation of the
 * Basis WebAssembly module. It follows a lazy-loading and idempotent
 * pattern: the first time it is called, it performs the initialization and
 * stores a promise. Subsequent calls will return the same promise without
 * re-initializing.
 *
 * This function must be successfully awaited before using the transcoder.
 *
 * @param transcoderPath The path to the `basis_transcoder.js` file.
 * @param wasmPath The path to the `basis_transcoder.wasm` file.
 * @returns A promise that resolves when the transcoder is ready, or rejects if
 *     initialization fails.
 * @throws Error if initialization fails, allowing the caller to handle it.
 */
export async function initBasis(
  transcoderPath = "/basis_transcoder.js",
  wasmPath = "/basis_transcoder.wasm",
): Promise<void> {
  if (basisPromise) return basisPromise;

  console.log("[BasisModule] Starting Basis Universal initialization...");

  basisPromise = (async () => {
    try {
      const start = performance.now();

      // Dynamically import the JS wrapper
      const { BasisTranscoder } = (await import(
        /* @vite-ignore */ transcoderPath
      )) as { BasisTranscoder: BasisTranscoder };
      // telling vite to ignore that import at build time

      // Initialize the WASM module
      const basisModule = {} as BasisModule;
      await new Promise<void>((resolve, reject) => {
        basisModule.onRuntimeInitialized = () => {
          BASIS = basisModule;
          resolve();
        };
        basisModule.locateFile = (path, prefix) => {
          if (path.endsWith(".wasm")) return wasmPath;
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
      basisPromise = null; // Allow retry on failure
      throw error; // Propagate error to the caller
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

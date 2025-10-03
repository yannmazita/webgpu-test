// src/core/wasm/basisModule.ts

/**
 * Centralized Basis Universal WASM module loader.
 *
 * This module handles the dynamic loading and initialization of the Basis
 * transcoder library. It provides a singleton pattern for loading the WASM module.
 */

import type { BasisModule } from "@/core/types/basis";

let BASIS: BasisModule | null = null;
let basisPromise: Promise<void> | null = null;

/**
 * Initializes the Basis Universal transcoder WASM module.
 *
 * @param wasmPath Path to the basis_transcoder.wasm file (default: "/basis_transcoder.wasm")
 * @returns A promise that resolves when the transcoder is ready.
 */
export async function initBasis(
  wasmPath = "/basis_transcoder.wasm",
): Promise<void> {
  if (basisPromise) return basisPromise;

  console.log("[BasisModule] Starting Basis Universal initialization...");

  basisPromise = (async () => {
    try {
      const start = performance.now();

      // Import the factory function from the vendor directory
      // Vite will handle this as an ES module import
      const basisModule = await import("../../vendor/basis_transcoder.js");

      // The module exports a default function that is the factory
      // It might be wrapped, so we need to handle both cases
      let basisFactory: (config: Partial<BasisModule>) => Promise<BasisModule>;

      if (typeof basisModule.default === "function") {
        basisFactory = basisModule.default;
      } else if (typeof basisModule === "function") {
        basisFactory = basisModule as any;
      } else {
        throw new Error(
          "Could not find Basis factory function in imported module. " +
            "Module keys: " +
            Object.keys(basisModule).join(", "),
        );
      }

      console.log(
        "[BasisModule] Factory function loaded, initializing module...",
      );

      // Call the factory function with our configuration
      BASIS = await basisFactory({
        locateFile: (path: string) => {
          if (path.endsWith(".wasm")) {
            console.log(`[BasisModule] Locating WASM file: ${wasmPath}`);
            return wasmPath;
          }
          return path;
        },
      });

      // The factory returns a promise that resolves to the initialized module
      // The onRuntimeInitialized callback is optional and might be called automatically
      if (
        BASIS.onRuntimeInitialized &&
        typeof BASIS.onRuntimeInitialized === "function"
      ) {
        // If it exists as a function, call it
        BASIS.onRuntimeInitialized();
      }

      const loadTime = performance.now() - start;
      console.log(
        `[BasisModule] Basis Universal transcoder loaded in ${loadTime.toFixed(2)}ms`,
      );
      console.log(
        "[BasisModule] Available formats:",
        Object.keys(BASIS.TranscoderTextureFormat || {}),
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

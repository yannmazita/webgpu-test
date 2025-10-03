// vite-plugin-vendor.ts
import type { Plugin } from "vite";

/**
 * Creates a Vite plugin to adapt the legacy `basis_transcoder.js` script for ES module compatibility.
 *
 * @remarks
 * The official `basis_transcoder.js` is a UMD (Universal Module Definition) script. When executed,
 * it creates a global `BASIS` variable but does not include an ES module `export` statement,
 * making it incompatible with Vite's ESM-native `import` mechanism.
 *
 * This plugin uses Vite's `transform` hook to intercept the `basis_transcoder.js` file
 * and append `export default BASIS;` to its content. This modification makes the `BASIS`
 * factory function the module's default export, allowing it to be imported cleanly using
 * standard ES module syntax (ie `import BASIS from '...'`).
 *
 * @returns A Vite Plugin object configured to transform the Basis transcoder script.
 */
export function vitePluginBasisTranscoderEsm(): Plugin {
  return {
    name: "vendor-plugin",
    transform(code, id) {
      // Handle the basis_transcoder.js file specially
      if (id.includes("basis_transcoder.js")) {
        // Ensure it's treated as an ES module with a default export
        // The IIFE returns a function, we need to export it
        return {
          code: code + "\nexport default BASIS;",
          map: null,
        };
      }
    },
  };
}

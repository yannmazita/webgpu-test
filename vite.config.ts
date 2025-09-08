// vite.config.ts

import glsl from "vite-plugin-glsl";
import { defineConfig } from "vite";
import path from "path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

const ReactCompilerConfig = {
  /* ... */
};

export default defineConfig({
  plugins: [
    glsl({
      defaultExtension: "wgsl",
    }),
    // Add these two plugins
    wasm(),
    topLevelAwait(),
  ],
  envDir: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // jsimgui and mikktspace load their own wasm files and we don't want
  // Vite to try and process them.
  optimizeDeps: {
    exclude: ["@mori2003/jsimgui", "mikktspace"],
  },
  server: {
    // These headers are required for SharedArrayBuffer, which is used by
    // WebAssembly and is required by WebGPU for timers.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});

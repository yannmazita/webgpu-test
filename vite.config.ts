// vite.config.ts

import glsl from "vite-plugin-glsl";
import { defineConfig } from "vite";
import path from "path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { vitePluginBasisTranscoderEsm } from "./vite-plugin-basis";

export default defineConfig({
  plugins: [
    glsl({
      defaultExtension: "wgsl",
    }),
    wasm(),
    topLevelAwait(),
    vitePluginBasisTranscoderEsm(),
  ],
  worker: {
    plugins: () => [wasm(), topLevelAwait()],
  },
  envDir: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          physics: ["@dimforge/rapier3d"], // Separate chunk for physics
        },
      },
    },
  },

  // these libraries load their own wasm files and we don't want
  // Vite to try and process them.
  optimizeDeps: {
    exclude: [
      "@mori2003/jsimgui",
      "mikktspace",
      "@dimforge/rapier3d",
      "meshoptimizer",
      "basis-universal",
    ],
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

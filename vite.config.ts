import glsl from "vite-plugin-glsl";
import { defineConfig } from "vite";
import path from "path";

const ReactCompilerConfig = {
  /* ... */
};

export default defineConfig({
  plugins: [
    glsl({
      defaultExtension: "wgsl",
    }),
  ],
  envDir: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // jsimgui loads its own wasm files and we don't want Vite to try and process them.
  optimizeDeps: {
    exclude: ["@mori2003/jsimgui"],
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

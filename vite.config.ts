import glsl from "vite-plugin-glsl";
import { defineConfig } from "vite";
import path from "path";

const ReactCompilerConfig = {
  /* ... */
};

export default defineConfig({
  plugins: [glsl()],
  envDir: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

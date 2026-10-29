import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["web-ifc"]
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/web-ifc")) return "ifc-engine";
          if (id.includes("node_modules/three/examples") || id.includes("node_modules/three/build/three.webgpu")) {
            return "three-extras";
          }
          if (id.includes("node_modules/three")) return "three-core";
          return undefined;
        }
      }
    }
  }
});

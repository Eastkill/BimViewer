import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";

// Dev-server only: lets the test bench (tests/bench) store its results in tests/results/.
const benchResultsPlugin = () => ({
  name: "bench-results",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__bench-results", (req, res) => {
      const name = new URL(req.url, "http://localhost").searchParams.get("name") ?? "";
      if (req.method !== "POST" || !/^[\w-]+$/.test(name)) {
        res.statusCode = 400;
        res.end("bad request");
        return;
      }
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const dir = join(server.config.root, "tests", "results");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${name}.json`), Buffer.concat(chunks));
        res.end("ok");
      });
    });
  }
});

export default defineConfig({
  plugins: [benchResultsPlugin()],
  // Relative base: the built app can be hosted from any sub-directory of a static server.
  base: "./",
  optimizeDeps: {
    exclude: ["web-ifc"]
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.js"]
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

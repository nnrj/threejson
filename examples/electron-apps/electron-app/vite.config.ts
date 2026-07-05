import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    open: false,
    fs: {
      allow: [repoRoot]
    }
  },
  build: {
    rollupOptions: {
      external: ["@comfyorg/fbx-exporter-three"]
    }
  }
});

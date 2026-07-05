import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  base: "./",
  plugins: [vue()],
  server: {
    port: 5174,
    strictPort: true,
    open: false,
    fs: {
      allow: [repoRoot]
    }
  }
});

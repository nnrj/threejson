import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    open: false,
    fs: {
      allow: [repoRoot]
    }
  }
});

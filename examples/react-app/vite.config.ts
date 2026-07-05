import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    open: true,
    // Linked `threejson` (file:../..) resolves into the monorepo root; allow reading that tree.
    fs: {
      allow: [repoRoot]
    }
  },
  preview: {
    open: true
  }
});

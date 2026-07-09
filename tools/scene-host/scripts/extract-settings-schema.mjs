/**
 * One-off maintainer script: copy settings schema from frozen tools/old_version/scene-editor.html
 * into shared/js/editorSettingsSchema.js (do not import baseline at runtime).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const htmlPath = path.join(repoRoot, "tools/old_version/scene-editor.html");
const outPath = path.join(repoRoot, "tools/scene-host/shared/js/editorSettingsSchema.js");

const lines = fs.readFileSync(htmlPath, "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.includes("Editor Settings: defaults & schema"));
const endLine = lines.findIndex((l) => l.trim() === "let editorSettings = null;");
if (start < 0 || endLine < 0) {
  throw new Error("Could not find settings block markers in scene-editor.html");
}

const slice = lines.slice(start + 1, endLine);
const body = slice
  .map((line) => line.replace(/^  const /, "export const "))
  .join("\n");

const header = `/**
 * Editor settings schema — copied from tools/old_version/scene-editor.html (frozen baseline).
 * scene-host must not import baseline HTML; keep keys/paths aligned manually.
 * Regenerate: node tools/scene-host/scripts/extract-settings-schema.mjs
 */

`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, header + body + "\n");
console.log("Wrote", outPath);

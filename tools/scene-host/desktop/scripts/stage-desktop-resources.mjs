import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../../..");
const stageRoot = path.join(desktopRoot, ".pack");
const stageProjectRoot = path.join(stageRoot, "threejson-root");

const RESOURCE_DIRS = [
  "builtins",
  "core",
  "domains",
  "extensions",
  "assets",
  "tools/scene-host/editor",
  "tools/scene-host/player",
  "tools/scene-host/shared",
  "tools/scene-host/scripts",
  "tools/scene-host/README.md",
  "tools/scene-host/PHASE5-retirement.md",
  "tools/threejson-agent/bridge"
];

function copyResource(relPath) {
  const from = path.join(repoRoot, relPath);
  const to = path.join(stageProjectRoot, relPath);
  if (!existsSync(from)) {
    console.warn(`[stage-desktop-resources] skip missing: ${relPath}`);
    return;
  }
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`[stage-desktop-resources] copied: ${relPath}`);
}

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stageProjectRoot, { recursive: true });
for (const relPath of RESOURCE_DIRS) {
  copyResource(relPath);
}
console.log(`[stage-desktop-resources] staged at ${stageProjectRoot}`);

#!/usr/bin/env node
/**
 * Placeholder: print build instructions for tools/threejson-agent/components/bin.
 * Usage: node tools/dev/build/build-threejson-component.mjs [componentId]
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const componentId = process.argv[2] || "asset-search";
const platform = `${process.platform}-${process.arch}`;
const binDir = path.join(repoRoot, "tools/threejson-agent/components/bin", platform);
const exe = process.platform === "win32" ? `${componentId}.exe` : componentId;
const target = path.join(binDir, exe);

console.log(`Component: ${componentId}`);
console.log(`Platform:  ${platform}`);
console.log(`Target:    ${target}`);
console.log("");
if (existsSync(target)) {
  console.log("Binary already present.");
} else {
  console.log("Binary missing. Options:");
  console.log("  1. Set THREEJSON_USE_PYTHON_COMPONENTS=1 for dev (Python module fallback)");
  console.log("  2. Build with PyInstaller — see tools/threejson-agent/components/README.md");
  console.log("  3. Copy a prebuilt binary to the target path above");
}
process.exit(existsSync(target) ? 0 : 1);

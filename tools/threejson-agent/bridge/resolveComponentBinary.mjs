/**
 * Resolve packaged subcomponent binaries under tools/threejson-agent/components/bin.
 * Dev fallback: THREEJSON_USE_PYTHON_COMPONENTS=1 uses documented python-module id.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const componentsRoot = path.join(__dirname, "../components");

/**
 * @param {string} componentId
 * @returns {{ kind: "binary", path: string } | { kind: "python-module", module: string } | null}
 */
export function resolveComponentBinary(componentId) {
  const platform = `${process.platform}-${process.arch}`;
  const binDir = path.join(componentsRoot, "bin", platform);
  const exe =
    process.platform === "win32" ? `${componentId}.exe` : componentId;
  const candidate = path.join(binDir, exe);
  if (existsSync(candidate)) {
    return { kind: "binary", path: candidate };
  }
  if (process.env.THREEJSON_USE_PYTHON_COMPONENTS === "1") {
    if (componentId === "asset-search") {
      return { kind: "python-module", module: "threejson_agent.asset_bridge_entry" };
    }
  }
  return null;
}

/**
 * @param {string} componentId
 * @returns {string}
 */
export function missingComponentMessage(componentId) {
  return (
    `Subcomponent "${componentId}" binary not found for ${process.platform}-${process.arch}. ` +
    `Build tools/threejson-agent/components/bin or set THREEJSON_USE_PYTHON_COMPONENTS=1 for dev.`
  );
}

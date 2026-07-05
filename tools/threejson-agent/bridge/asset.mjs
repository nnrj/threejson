/**
 * Node bridge: stdin JSON → asset subcomponent (platform binary or Python entry) → stdout JSON.
 * Python CLI/GUI must call this bridge, not import asset_provider directly.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveComponentBinary,
  missingComponentMessage
} from "./resolveComponentBinary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
/** Python package lives under shell/py (not threejson-agent root). */
const shellPyRoot = path.join(__dirname, "..", "shell", "py");
const COMPONENT_ID = "asset-search";

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function resolvePythonExecutable() {
  return process.env.THREEJSON_PYTHON || process.env.PYTHON || "python";
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {object} payload
 * @param {{ cwd: string, env?: object }} spawnOpts
 */
function spawnWithJsonPayload(command, args, payload, spawnOpts) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...spawnOpts,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => {
      stdout += c.toString("utf8");
    });
    proc.stderr.on("data", (c) => {
      stderr += c.toString("utf8");
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `asset component exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout || "{}"));
      } catch (err) {
        reject(new Error(`asset component invalid JSON: ${err?.message || err}`));
      }
    });
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

function spawnPythonModule(payload) {
  const python = resolvePythonExecutable();
  return spawnWithJsonPayload(
    python,
    ["-m", "threejson_agent.asset_bridge_entry"],
    payload,
    {
      cwd: shellPyRoot,
      env: {
        ...process.env,
        PYTHONPATH: shellPyRoot
      }
    }
  );
}

/**
 * @param {object} payload
 * @returns {Promise<object>}
 */
export async function runAssetBridge(payload) {
  const projectRoot = path.resolve(payload.projectRoot || repoRoot);
  const body = { ...payload, projectRoot: String(projectRoot) };
  const resolved = resolveComponentBinary(COMPONENT_ID);

  if (resolved?.kind === "binary") {
    return spawnWithJsonPayload(resolved.path, [], body, { cwd: projectRoot });
  }
  if (resolved?.kind === "python-module") {
    return spawnPythonModule(body);
  }
  // Dev default when no platform binary is shipped yet
  return spawnPythonModule(body);
}

const raw = await readStdin();
const opts = JSON.parse(raw || "{}");
let result;
try {
  result = await runAssetBridge(opts);
} catch (err) {
  const hint = missingComponentMessage(COMPONENT_ID);
  process.stderr.write(`${err?.message || err}\n${hint}\n`);
  process.exit(1);
}
if (result.complianceNotice) {
  process.stderr.write(`${result.complianceNotice}\n`);
}
if (result.ok === false) {
  process.stderr.write(`${result.error || "asset bridge failed"}\n`);
  process.exit(1);
}
process.stdout.write(JSON.stringify(result));

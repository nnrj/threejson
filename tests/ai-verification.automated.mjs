/**
 * Static AI verification (no API keys). Run: npm run verify:ai-static
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { validateSceneJson } from "../core/ai/agentTools.js";
import { listTextureUrlPointers } from "../core/ai/textureAiService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const fixtureDir = path.join(__dirname, "fixtures", "ai-test");
const bridgeDir = path.join(repoRoot, "tools", "threejson-agent", "bridge");
const shellPyDir = path.join(repoRoot, "tools", "threejson-agent", "shell", "py");

function readFixture(name) {
  return readFileSync(path.join(fixtureDir, name), "utf8");
}

test("fixture base-scene-friendly validates", () => {
  const r = validateSceneJson(readFixture("base-scene-friendly.json"));
  assert.equal(r.ok, true);
  assert.ok((r.boxCount || 0) >= 3);
});

test("fixture scene-with-texture-slots exposes textureUrl pointer slots", () => {
  const scene = JSON.parse(readFixture("scene-with-texture-slots.json"));
  const ptrs = listTextureUrlPointers(scene);
  assert.ok(ptrs.length >= 2);
  assert.ok(ptrs.every((p) => p.endsWith("/textureUrl")));
});

test("fixture invalid-scene fails validateSceneJson", () => {
  const r = validateSceneJson(readFixture("invalid-scene.json"));
  assert.equal(r.ok, false);
});

test("agent setting.example.json exists with paths.redirectRelative", () => {
  const examplePath = path.join(repoRoot, "tools", "threejson-agent", "setting.example.json");
  assert.ok(existsSync(examplePath));
  const j = JSON.parse(readFileSync(examplePath, "utf8"));
  assert.equal(j.paths?.redirectRelative, false);
  assert.ok(j._providerBaseUrlHints);
});

test("mcp setting.example.json exists", () => {
  const p = path.join(repoRoot, "tools", "mcp-threejson", "setting.example.json");
  assert.ok(existsSync(p));
});

test("Node bridge scripts pass syntax check", () => {
  const scripts = ["scene-agent.mjs", "texture-fill.mjs", "asset.mjs", "resolveComponentBinary.mjs"];
  for (const name of scripts) {
    const file = path.join(bridgeDir, name);
    assert.ok(existsSync(file), `${name} missing`);
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(r.status, 0, `${name}: ${r.stderr || r.stdout}`);
  }
});

test("Python agent config unittest passes when deps installed", () => {
  const pipCheck = spawnSync("python", ["-c", "import click, httpx"], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (pipCheck.status !== 0) {
    console.log(
      "SKIP Python unittest: pip install -r tools/threejson-agent/shell/py/requirements.txt"
    );
    return;
  }
  const r = spawnSync("python", ["-m", "unittest", "discover", "-s", "tests", "-q"], {
    cwd: shellPyDir,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  assert.equal(
    r.status,
    0,
    `Python unittest failed:\n${r.stdout}\n${r.stderr}`
  );
});

test("components manifest registers asset-search", () => {
  const manifestPath = path.join(
    repoRoot,
    "tools",
    "threejson-agent",
    "components",
    "manifest.json"
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.ok(Array.isArray(manifest.components));
  assert.ok(manifest.components.some((c) => c.id === "asset-search"));
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "assets", "json", "demo-show", "manifest.json");

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function localPathFromReference(reference) {
  return String(reference || "").split(/[?#]/, 1)[0];
}

test("website examples expose the complete Particle V2 fixture set", () => {
  const section = readManifest().find((entry) => entry.section === "particles");
  assert.ok(section, "particles section should exist");
  const ids = new Set(section.items.map((item) => item.id));
  for (const expected of [
    "particle-v2-sources",
    "particle-text-logo",
    "particle-fire-smoke",
    "particle-rain-snow",
    "particle-attractor",
    "particle-mesh-surface",
    "particle-webgl-compute"
  ]) {
    assert.ok(ids.has(expected), `missing website particle example: ${expected}`);
  }
  for (const item of section.items) {
    assert.ok(item.json, `${item.id} should expose its JSON descriptor`);
    assert.equal(fs.existsSync(path.join(repoRoot, localPathFromReference(item.json))), true, item.json);
  }
});

test("website examples expose runnable TSL and WebGPU previews without WebGL thumbnail loading", () => {
  const section = readManifest().find((entry) => entry.section === "webgpu-tsl");
  assert.ok(section, "webgpu-tsl section should exist");
  assert.deepEqual(
    section.items.map((item) => item.id),
    ["tsl-materials", "tsl-burning-model", "webgpu-compute-particles"]
  );
  for (const item of section.items) {
    assert.equal(item.thumbnail, false, `${item.id} must not enter the default WebGL thumbnail runner`);
    assert.equal(item.badgeTone, "preview");
    assert.equal(fs.existsSync(path.join(repoRoot, localPathFromReference(item.json))), true, item.json);
    assert.equal(fs.existsSync(path.join(repoRoot, localPathFromReference(item.external))), true, item.external);
  }
});

test("website gallery distinguishes dedicated capability covers and skips external-only downloads", () => {
  const source = fs.readFileSync(path.join(repoRoot, "website", "js", "site.js"), "utf8");
  assert.match(source, /exampleCapabilityCover/);
  assert.match(source, /data-thumbnail-disabled/);
  assert.match(source, /if \(!item\?\.json\) continue/);
});

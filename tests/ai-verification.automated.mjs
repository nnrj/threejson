/** Static AI/tool verification: no provider credentials or browser downloads. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateSceneJson } from "../core/ai/agentTools.js";
import { listMaterialTextureSlots } from "../core/texture/index.js";
import { createSceneToolHost } from "../packages/scene-tools/js/index.js";
import { runSceneAi } from "../packages/scene-tools/js/ai.js";
import { runTextureFill } from "../packages/scene-tools/js/texture-fill.mjs";
const fixture = (name) => readFileSync(new URL("./fixtures/ai-test/" + name, import.meta.url), "utf8");
test("base and invalid fixture validation remains available", () => {
  assert.equal(validateSceneJson(fixture("base-scene-friendly.json")).ok, true);
  assert.equal(validateSceneJson(fixture("invalid-scene.json")).ok, false);
});
test("texture slots remain exposed after retiring Python", () => {
  const slots = listMaterialTextureSlots(JSON.parse(fixture("scene-with-texture-slots.json")));
  assert.ok(slots.some((slot) => slot.slot === "normal"));
});
test("explicit AI and texture APIs are callable but not invoked on ordinary tools", async () => {
  assert.equal(typeof runSceneAi, "function"); assert.equal(typeof runTextureFill, "function");
  const original = globalThis.fetch; globalThis.fetch = () => { throw new Error("Unexpected network"); };
  const host = createSceneToolHost();
  try { const session = await host.open({ json: JSON.parse(fixture("base-scene-friendly.json")) }); assert.equal((await host.query({ sessionId: session.sessionId })).ok, true); }
  finally { globalThis.fetch = original; await host.dispose(); }
});

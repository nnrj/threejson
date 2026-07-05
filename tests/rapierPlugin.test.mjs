import { test } from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { createRapierBoxDropPlugin } from "../extensions/physics-rapier/rapierPlugin.js";

test("Rapier plugin steps and updates mesh position", async () => {
  await RAPIER.init();
  const mesh = { position: { x: 0, y: 0, z: 0 } };
  const plugin = await createRapierBoxDropPlugin({ mesh, RAPIER });
  for (let i = 0; i < 12; i++) {
    plugin.beforePhysics();
  }
  assert.ok(mesh.position.y < 5.9, "box should fall under gravity");
});

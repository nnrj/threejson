import { test } from "node:test";
import assert from "node:assert/strict";
import { applyJsonPatchToJsonDocument } from "../core/handler/jsonPatchApplyCore.js";

test("JSON Patch replace on whitelisted path", () => {
  const doc = { position: { x: 1, y: 2, z: 3 }, threeJsonId: "t1" };
  const r = applyJsonPatchToJsonDocument(doc, [{ op: "replace", path: "/position/x", value: 99 }]);
  assert.equal(r.ok, true);
  assert.equal(doc.position.x, 99);
});

test("JSON Patch rejects non-whitelisted path", () => {
  const doc = {};
  const r = applyJsonPatchToJsonDocument(doc, [{ op: "replace", path: "/evil", value: 1 }]);
  assert.equal(r.ok, false);
});

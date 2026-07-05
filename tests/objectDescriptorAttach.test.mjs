import { test } from "node:test";
import assert from "node:assert/strict";
import { setUserDataObjJson, attachDescriptorToObject } from "../core/handler/objectDescriptorAttach.js";

test("setUserDataObjJson merges objJson", () => {
  const o = { userData: { a: 1 } };
  setUserDataObjJson(o, { name: "x" });
  assert.equal(o.userData.a, 1);
  assert.equal(o.userData.objJson.name, "x");
});

test("attachDescriptorToObject attaches when missing", () => {
  const o = {};
  const d = { id: 1 };
  const j = attachDescriptorToObject(o, d);
  assert.equal(j, o.userData.objJson);
  assert.equal(o.userData.objJson.id, 1);
});

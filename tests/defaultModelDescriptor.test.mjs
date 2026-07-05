import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDefaultDeployDescriptor,
  isDefaultModelEnabled
} from "../core/handler/defaultModelDescriptor.js";

test("buildDefaultDeployDescriptor sets sourceObjType from unknown objType", () => {
  const out = buildDefaultDeployDescriptor({ objType: "container", name: "c1" }, null);
  assert.equal(out.objType, "default");
  assert.equal(out.sourceObjType, "container");
  assert.equal(out.name, "c1");
});

test("buildDefaultDeployDescriptor omits sourceObjType when rawType is default", () => {
  const out = buildDefaultDeployDescriptor({ objType: "default", name: "x" }, null);
  assert.equal(out.objType, "default");
  assert.equal(out.sourceObjType, undefined);
});

test("buildDefaultDeployDescriptor merges businessInfo without inventing businessName", () => {
  const out = buildDefaultDeployDescriptor(
    { objType: "wall", businessInfo: { deviceTypeCode: "x" } },
    null
  );
  assert.equal(out.sourceObjType, "wall");
  assert.equal(out.businessInfo?.deviceTypeCode, "x");
  assert.equal(out.businessInfo?.businessName, undefined);
});

test("isDefaultModelEnabled reads sceneConfig flag", () => {
  assert.equal(isDefaultModelEnabled({ jsonData: { sceneConfig: { enableDefaultModel: true } } }), true);
  assert.equal(isDefaultModelEnabled({ jsonData: {} }), false);
});

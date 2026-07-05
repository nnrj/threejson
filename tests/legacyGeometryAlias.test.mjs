import assert from "node:assert/strict";
import { test } from "node:test";

import { applyLegacyGeometryObjTypeAlias } from "../core/handler/legacyGeometryAlias.js";

test("roundedBox alias fills RoundedBoxGeometry type and defaults", () => {
  const next = applyLegacyGeometryObjTypeAlias({
    objType: "roundedBox",
    width: 5,
    height: 2.5,
    material: { type: "MeshStandardMaterial", color: "#ffffff" }
  });
  assert.equal(next.geometry.type, "RoundedBoxGeometry");
  assert.equal(next.geometry.width, 5);
  assert.equal(next.geometry.height, 2.5);
  assert.equal(next.geometry.radius, 0.1);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearAssetRegistry,
  registerAssetLibrary
} from "../core/cache/assetRegistry.js";
import {
  resolveAssetRefsForRecord,
  resolveSharePolicy
} from "../core/util/resolveAssetRefs.js";

test("resolveSharePolicy defaults to clone", () => {
  assert.deepEqual(resolveSharePolicy({}), { geometry: "clone", material: "clone" });
  assert.deepEqual(resolveSharePolicy({ sharePolicy: { geometry: "shared" } }), {
    geometry: "shared",
    material: "clone"
  });
});

test("resolveAssetRefsForRecord expands geometryRef and materialRef", () => {
  clearAssetRegistry();
  registerAssetLibrary([
    {
      threeJsonId: "geom-box",
      assetKind: "geometryPreset",
      geometry: { type: "RoundedBoxGeometry", width: 2, height: 1, depth: 1, radius: 0.1, segments: 4 }
    },
    {
      threeJsonId: "mat-metal",
      assetKind: "materialPreset",
      material: { type: "MeshStandardMaterial", color: "#aaaaaa", metalness: 0.8 }
    }
  ]);

  const resolved = resolveAssetRefsForRecord({
    objType: "pedestal",
    geometryRef: "lib://geom-box",
    geometryOverrides: { width: 4 },
    materialRef: "lib://mat-metal",
    materialOverrides: { color: "#ffcc00" }
  });

  assert.equal(resolved.geometry.type, "RoundedBoxGeometry");
  assert.equal(resolved.geometry.width, 4);
  assert.equal(resolved.material.color, "#ffcc00");
  assert.equal(resolved.__resolvedGeometryRef, "geom-box");
  assert.equal(resolved.__resolvedMaterialRef, "mat-metal");
  clearAssetRegistry();
});

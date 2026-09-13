import { test } from "node:test";
import assert from "node:assert/strict";
import { createTextureAssignmentMaterial } from "../core/texture/textureAssignmentData.js";

test("partial archive provenance never treats a remote/proxy slot as a durable replica", () => {
  const maps = { baseColor: "https://source.test/color.png", normal: "https://source.test/normal.png" };
  const material = createTextureAssignmentMaterial({ type: "physical", roughness: 0.4, clearcoat: 1 }, {
    maps,
    candidate: { archived: true, maps, archiveMaps: { baseColor: "https://storage.test/color.png" }, runtimeMaps: {
      baseColor: "https://storage.test/color.png", normal: "https://proxy.test/ephemeral.png"
    } }
  });
  assert.equal(material.type, "physical"); assert.equal(material.clearcoat, 1);
  assert.equal(material.textureUrl, maps.baseColor); assert.equal(material.normalMap, maps.normal);
  assert.deepEqual(material.textureResources.baseColor.replicas, ["https://storage.test/color.png"]);
  assert.equal(material.textureResources.normal.replicas, undefined);
});

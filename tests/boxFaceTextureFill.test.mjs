import assert from "node:assert/strict";
import { test } from "node:test";

import { fillMissingBoxFaceTextureUrls } from "../core/builder/modelBuilder.js";

const acFaceMaterials = () => [
  { color: "#7a7d82", type: "standard", receiveShadow: true },
  { color: "#7a7d82", type: "standard", receiveShadow: true },
  { color: "#8E8E8E", type: "standard", receiveShadow: true },
  { color: "#7a7d82", type: "standard", receiveShadow: true },
  {
    color: "#8A8A8A",
    type: "standard",
    receiveShadow: true,
    textureUrl: "/assets/textures/device/air_conditioner_back.png"
  },
  {
    color: "#8A8A8A",
    type: "standard",
    receiveShadow: true,
    textureUrl: "/assets/textures/device/air_conditioner_front.png"
  }
];

test("fillMissingBoxFaceTextureUrls does not copy texture onto heterogeneous AC faces", () => {
  const record = { materials: acFaceMaterials() };
  fillMissingBoxFaceTextureUrls(record);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(record.materials[i].textureUrl, undefined, `face ${i} should stay solid`);
  }
  assert.equal(
    record.materials[4].textureUrl,
    "/assets/textures/device/air_conditioner_back.png"
  );
  assert.equal(
    record.materials[5].textureUrl,
    "/assets/textures/device/air_conditioner_front.png"
  );
});

test("fillMissingBoxFaceTextureUrls still fills uniform six-face placeholders", () => {
  const record = {
    material: { type: "standard", textureUrl: "/assets/textures/test.png" },
    materials: [
      { type: "standard", map: {} },
      { type: "standard", map: {} },
      { type: "standard", map: {} },
      { type: "standard", map: {} },
      { type: "standard", map: {} },
      { type: "standard", map: {} }
    ]
  };
  fillMissingBoxFaceTextureUrls(record);
  for (let i = 0; i < 6; i += 1) {
    assert.equal(record.materials[i].textureUrl, "/assets/textures/test.png");
  }
});

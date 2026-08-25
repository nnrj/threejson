import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMaterialDescriptorProperties,
  createMaterialFromDescriptor,
  inferMaterialType,
  normalizeMaterialType
} from "../core/builder/material/materialFactory.js";

test("material factory creates every friendly classic material type", () => {
  const cases = [
    ["basic", "isMeshBasicMaterial"],
    ["lambert", "isMeshLambertMaterial"],
    ["phong", "isMeshPhongMaterial"],
    ["standard", "isMeshStandardMaterial"],
    ["physical", "isMeshPhysicalMaterial"],
    ["toon", "isMeshToonMaterial"],
    ["matcap", "isMeshMatcapMaterial"],
    ["normal", "isMeshNormalMaterial"]
  ];
  for (const [type, flag] of cases) {
    const material = createMaterialFromDescriptor({ type, color: "#336699" });
    assert.equal(material[flag], true, type);
    material.dispose();
  }
});

test("physical material maps advanced PBR properties", () => {
  const material = createMaterialFromDescriptor({
    type: "MeshPhysicalMaterial",
    color: "#abcdef",
    metalness: 0.3,
    roughness: 0.4,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
    transmission: 0.7,
    ior: 1.45,
    thickness: 0.5,
    attenuationColor: "#ffeecc",
    attenuationDistance: 12,
    sheen: 0.6,
    sheenColor: "#ff0000",
    iridescence: 0.9,
    anisotropy: 0.5,
    dispersion: 0.1,
    specularIntensity: 0.75,
    iridescenceThicknessRange: [120, 360]
  });
  assert.equal(material.isMeshPhysicalMaterial, true);
  assert.equal(material.clearcoat, 0.8);
  assert.equal(material.transmission, 0.7);
  assert.equal(material.ior, 1.45);
  assert.equal(material.sheen, 0.6);
  assert.equal(material.iridescence, 0.9);
  assert.equal(material.anisotropy, 0.5);
  assert.equal(material.dispersion, 0.1);
  assert.deepEqual(material.iridescenceThicknessRange, [120, 360]);
  material.dispose();
});

test("material inference promotes physical and standard descriptors without explicit type", () => {
  assert.equal(inferMaterialType({ transmission: 0.5 }), "physical");
  assert.equal(inferMaterialType({ roughness: 0.5 }), "standard");
  assert.equal(inferMaterialType({ color: "#fff" }), "phong");
  assert.equal(normalizeMaterialType("MeshPhysicalMaterial"), "physical");
});

test("runtime material updates cover PhysicalMaterial fields without reconstruction", () => {
  const material = createMaterialFromDescriptor({ type: "physical", color: "#ffffff" });
  applyMaterialDescriptorProperties(material, {
    clearcoat: 0.7,
    transmission: 0.6,
    ior: 1.4,
    thickness: 0.3,
    attenuationColor: "#f0d0b0",
    sheen: 0.5,
    sheenColor: "#00aaff",
    iridescence: 0.8,
    anisotropy: 0.4,
    dispersion: 0.12,
    clearcoatNormalScale: [0.5, 0.25],
    iridescenceThicknessRange: [140, 420]
  });
  assert.equal(material.clearcoat, 0.7);
  assert.equal(material.transmission, 0.6);
  assert.equal(material.ior, 1.4);
  assert.equal(material.sheen, 0.5);
  assert.equal(material.iridescence, 0.8);
  assert.equal(material.anisotropy, 0.4);
  assert.deepEqual(material.clearcoatNormalScale.toArray(), [0.5, 0.25]);
  assert.deepEqual(material.iridescenceThicknessRange, [140, 420]);
  material.dispose();
});

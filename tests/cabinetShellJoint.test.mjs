import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assignCabinetShellPanels,
  createCabinetJson
} from "../domains/device/cabinet/cabinetFactory.js";
import { cabinetGroup } from "../domains/device/deviceTemplates.js";

function wallAabb(geometry, position) {
  const hw = geometry.width / 2;
  const hh = geometry.height / 2;
  const hd = geometry.depth / 2;
  const { x, y, z } = position;
  return {
    minX: x - hw,
    maxX: x + hw,
    minY: y - hh,
    maxY: y + hh,
    minZ: z - hd,
    maxZ: z + hd
  };
}

function aabbOverlapVolume(a, b, epsilon = 1e-6) {
  const dx = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const dy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const dz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  if (dx <= epsilon || dy <= epsilon || dz <= epsilon) {
    return 0;
  }
  return dx * dy * dz;
}

test("assignCabinetShellPanels avoids overlapping wall volumes", () => {
  const groupObj = JSON.parse(JSON.stringify(cabinetGroup));
  const width = 6;
  const length = 12;
  const height = 20;
  const wallDepth = 0.2;
  assignCabinetShellPanels(groupObj, width, length, height, wallDepth);

  const boxes = groupObj.boxModelList.slice(0, 6).map((wall, index) => ({
    name: wall.name,
    aabb: wallAabb(wall.geometry, wall.position),
    index
  }));

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const overlap = aabbOverlapVolume(boxes[i].aabb, boxes[j].aabb);
      assert.equal(
        overlap,
        0,
        `${boxes[i].name} and ${boxes[j].name} should not overlap (volume=${overlap})`
      );
    }
  }
});

test("assignCabinetShellPanels applies shell textures on walls without doors", () => {
  const groupObj = JSON.parse(JSON.stringify(cabinetGroup));
  assignCabinetShellPanels(groupObj, 6, 12, 20, 0.2, {
    doors: [{ side: "front", swing: "right", leafCount: 1 }]
  });
  const byName = Object.fromEntries(groupObj.boxModelList.map((wall) => [wall.name, wall]));
  assert.match(byName.cabinetTop.material.textureUrl, /cabinet_top_wall\.png$/);
  assert.match(byName.cabinetBottom.material.textureUrl, /cabinet_bottom_wall\.png$/);
  assert.match(byName.cabinetLeft.material.textureUrl, /cabinet_left_wall\.png$/);
  assert.match(byName.cabinetRight.material.textureUrl, /cabinet_right_wall\.png$/);
  assert.match(byName.cabinetBack.material.textureUrl, /cabinet_back_wall\.png$/);
});

test("assignCabinetShellPanels skips back wall texture when back has a door", () => {
  const groupObj = JSON.parse(JSON.stringify(cabinetGroup));
  assignCabinetShellPanels(groupObj, 6, 12, 20, 0.2, {
    doors: [
      { side: "front", swing: "right", leafCount: 1 },
      { side: "back", swing: "right", leafCount: 2 }
    ]
  });
  const back = groupObj.boxModelList.find((wall) => wall.name === "cabinetBack");
  assert.ok(back);
  assert.equal(back.material?.textureUrl, undefined);
});

test("createCabinetJson still merges shell walls after butt-joint layout", () => {
  const json = createCabinetJson({
    geometry: { width: 6, length: 12, height: 20 },
    doors: [{ side: "front", swing: "right", leafCount: 1 }]
  });
  const shell = (json.subScene || []).find((entry) => entry.merge === true);
  assert.ok(shell, "merged shell mesh expected");
  assert.equal(shell.mergedFragmentCount, 5);
  assert.ok(
    shell.materialArr.some((material) =>
      String(material?.textureUrl || "").includes("cabinet_back_wall.png")
    )
  );
});

test("createCabinetJson omits back shell when back door is configured", () => {
  const json = createCabinetJson({
    geometry: { width: 6, length: 12, height: 20 },
    doors: [
      { side: "front", swing: "right", leafCount: 1 },
      { side: "back", swing: "right", leafCount: 2 }
    ]
  });
  const shell = (json.subScene || []).find((entry) => entry.merge === true);
  assert.ok(shell, "merged shell mesh expected");
  assert.equal(shell.mergedFragmentCount, 4);
  assert.ok(
    !shell.materialArr.some((material) =>
      String(material?.textureUrl || "").includes("cabinet_back_wall.png")
    )
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { normalizeFriendlyScenePayload } from "../core/handler/sceneFriendlyNormalizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const roomShowPath = path.join(__dirname, "../assets/json/roomShow.json");

test("roomShow.json normalizes to a full debug scene objectList", () => {
  const payload = JSON.parse(fs.readFileSync(roomShowPath, "utf8"));
  assert.equal(payload.threeJsonId, "roomShow");

  const normalized = normalizeFriendlyScenePayload(payload);
  const list = normalized.objectList || [];
  assert.ok(list.length >= 60, `expected rich objectList, got ${list.length}`);

  const objTypes = new Set(list.map((item) => item.objType));
  for (const expected of ["floor", "wall", "door", "box", "domain", "wind", "heatMap", "line", "infoPanel", "group", "tube", "sphere", "sprite", "plane"]) {
    assert.ok(objTypes.has(expected), `missing objType: ${expected}`);
  }

  const names = list.map((item) => item.name).filter(Boolean);
  assert.ok(names.filter((n) => n === "room-glass").length >= 1, "expected room-glass batch name");
  // roomShow merged temperature probes into a single host tempe-sensor record
  assert.ok(names.filter((n) => n === "tempe-sensor").length >= 1, "expected at least one tempe-sensor probe");
  assert.ok(names.filter((n) => n === "leak-line").length >= 2, "expected leak-line records");
  assert.ok(names.filter((n) => n === "air-conditioning").length >= 5, "expected air-conditioning units");

  const cabinets = list.filter((item) => item.domain === "device.cabinet");
  assert.equal(cabinets.length, 18, "expected 18 device.cabinet domain records");
  assert.ok(
    cabinets.every((item) => item.name === "cabinet" && item.objType === "domain"),
    "cabinets use domain objType and shared cabinet name"
  );

  const netCabinets = payload.worldInfo.domainModelList.filter(
    (item) => item.threeJsonId === "room-cabinet-13"
  );
  assert.equal(netCabinets.length, 1, "room-show alarm demo: room-cabinet-13");
  const alarmCabinet = netCabinets[0];
  assert.equal(alarmCabinet.name, "cabinet");
  assert.equal(alarmCabinet.label, "机柜13");
  assert.deepEqual(alarmCabinet.position, { x: 3, y: 0, z: 12 });

  const headCabinet = payload.worldInfo.boxModelList.find(
    (item) => item.threeJsonId === "room-head-cabinet-a"
  );
  assert.ok(headCabinet, "room-show alarm demo: room-head-cabinet-a");
  assert.equal(headCabinet.name, "head-cabinet");
  assert.deepEqual(headCabinet.position, { x: 48, y: 9, z: -12 });

  assert.equal(payload.worldInfo.infoPanelList.length, 4);
  assert.equal(payload.worldInfo.windList.length, 7);
  assert.equal(payload.worldInfo.externalModelList.length, 1);
  assert.ok(!payload.worldInfo.objModelList, "roomShow should not use external OBJ shelves");
});

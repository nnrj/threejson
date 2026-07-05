import test from "node:test";
import assert from "node:assert/strict";

import {
  buildObjTexturePlans,
  normalizeMapsFolderFallback
} from "../core/builder/modelBuilder.js";

const alpacaObjInfo = {
  modelPath: "/assets/model/obj/maps_fallback/alpaca.obj",
  material: { color: "#2F3133" }
};

test("normalizeMapsFolderFallback defaults to off when omitted", () => {
  assert.equal(normalizeMapsFolderFallback(alpacaObjInfo), "off");
  assert.equal(normalizeMapsFolderFallback({}), "off");
});

test("normalizeMapsFolderFallback accepts off, map, full", () => {
  assert.equal(normalizeMapsFolderFallback({ mapsFolderFallback: "off" }), "off");
  assert.equal(normalizeMapsFolderFallback({ mapsFolderFallback: "map" }), "map");
  assert.equal(normalizeMapsFolderFallback({ mapsFolderFallback: "full" }), "full");
  assert.equal(
    normalizeMapsFolderFallback({ material: { mapsFolderFallback: "off" } }),
    "off"
  );
});

test("buildObjTexturePlans with mapsFolderFallback off skips sibling folder plans", () => {
  const state = buildObjTexturePlans({ ...alpacaObjInfo, mapsFolderFallback: "off" });
  assert.equal(state.source, "none");
  assert.equal(state.slotPlans, null);
});

test("buildObjTexturePlans default off skips sibling folder plans", () => {
  const state = buildObjTexturePlans(alpacaObjInfo);
  assert.equal(state.source, "none");
  assert.equal(state.slotPlans, null);
});

test("buildObjTexturePlans map mode only plans diffuse slot", () => {
  const state = buildObjTexturePlans({ ...alpacaObjInfo, mapsFolderFallback: "map" });
  assert.equal(state.source, "folder");
  assert.ok(state.slotPlans);
  assert.ok(state.slotPlans.map);
  assert.equal(state.slotPlans.metalnessMap, undefined);
  assert.equal(state.slotPlans.normalMap, undefined);
  assert.ok(
    state.slotPlans.map.candidates.some((url) =>
      url.includes("/assets/model/obj/maps_fallback/maps/map.jpg")
    )
  );
});

test("buildObjTexturePlans full mode plans all texture slots", () => {
  const state = buildObjTexturePlans({ ...alpacaObjInfo, mapsFolderFallback: "full" });
  assert.equal(state.source, "folder");
  assert.ok(state.slotPlans.map);
  assert.ok(state.slotPlans.metalnessMap);
  assert.ok(state.slotPlans.normalMap);
  assert.ok(
    state.slotPlans.metalnessMap.candidates.some((url) => url.includes("metalness.jpg"))
  );
});

test("explicit maps JSON ignores mapsFolderFallback for sibling step", () => {
  const state = buildObjTexturePlans({
    modelPath: "/assets/model/obj/maps_fallback/alpaca.obj",
    mapsFolderFallback: "off",
    maps: { map: "maps/map.jpg" }
  });
  assert.equal(state.source, "json");
  assert.ok(state.slotPlans.map);
  assert.ok(state.slotPlans.map.candidates[0].includes("maps/map.jpg"));
});

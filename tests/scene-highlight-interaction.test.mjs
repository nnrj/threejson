import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createHighlightTargetResolver,
  createSceneHighlightInteractionController,
  syncHighlightPassActivity
} from "../core/util/sceneHighlightInteraction.js";

function mockPass() {
  return {
    selectedObjects: [],
    enabled: true,
    visibleEdgeColor: { set() {} },
    hiddenEdgeColor: { set() {} }
  };
}

function mockBundle(overrides = {}) {
  return {
    infoPass: mockPass(),
    locatePass: mockPass(),
    alarmPass: mockPass(),
    resolveTarget: createHighlightTargetResolver(),
    clearSelectedObjects() {
      this.infoPass.selectedObjects = [];
      this.locatePass.selectedObjects = [];
      this.alarmPass.selectedObjects = [];
    },
    dispose() {},
    ...overrides
  };
}

describe("createHighlightTargetResolver", () => {
  it("resolves men/cabinet child to parent by default", () => {
    const resolve = createHighlightTargetResolver();
    const parent = { name: "cabinetGroup", type: "Group" };
    const child = { name: "men", parent };
    assert.equal(resolve(child), parent);
    assert.equal(resolve(parent), parent);
  });

  it("keeps domain deploy root named cabinet as highlight target", () => {
    const resolve = createHighlightTargetResolver();
    const scene = { name: "Scene", type: "Scene" };
    const cabinetRoot = {
      name: "cabinet",
      type: "Group",
      parent: scene,
      userData: {
        objJson: { objType: "domain", domain: "device.cabinet", name: "cabinet", label: "机柜07" }
      }
    };
    assert.equal(resolve(cabinetRoot), cabinetRoot);
  });
});

describe("createSceneHighlightInteractionController", () => {
  it("manages locate and info channels independently", () => {
    const bundle = mockBundle();
    const ctrl = createSceneHighlightInteractionController(bundle);
    const mesh = { name: "box", type: "Mesh" };

    ctrl.setHighlight(mesh);
    assert.ok(ctrl.isHighlightActive());
    assert.equal(bundle.locatePass.selectedObjects.length, 1);

    ctrl.setInfoHighlight(mesh);
    assert.equal(bundle.infoPass.selectedObjects.length, 1);
    assert.equal(bundle.locatePass.selectedObjects.length, 1);

    ctrl.clearHighlight();
    assert.equal(ctrl.isHighlightActive(), false);
    assert.equal(bundle.locatePass.selectedObjects.length, 0);
    assert.equal(bundle.infoPass.selectedObjects.length, 1);

    ctrl.clearAll();
    assert.equal(bundle.infoPass.selectedObjects.length, 0);
  });

  it("addLocateObjects concat without duplicates", () => {
    const bundle = mockBundle();
    const ctrl = createSceneHighlightInteractionController(bundle);
    const a = { name: "a" };
    const b = { name: "b" };
    ctrl.addLocateObjects([a]);
    ctrl.addLocateObjects([a, b]);
    assert.equal(bundle.locatePass.selectedObjects.length, 2);
  });

  it("removeLocateObject splices by reference", () => {
    const bundle = mockBundle();
    const ctrl = createSceneHighlightInteractionController(bundle);
    const a = { name: "a" };
    ctrl.addLocateObjects([a]);
    ctrl.removeLocateObject(a);
    assert.equal(bundle.locatePass.selectedObjects.length, 0);
  });
});

describe("syncHighlightPassActivity", () => {
  it("disables passes with empty selectedObjects", () => {
    const bundle = mockBundle();
    bundle.infoPass.selectedObjects = [];
    bundle.locatePass.selectedObjects = [];
    bundle.alarmPass.selectedObjects = [];
    syncHighlightPassActivity(bundle);
    assert.equal(bundle.infoPass.enabled, false);
    assert.equal(bundle.locatePass.enabled, false);
    assert.equal(bundle.alarmPass.enabled, false);
  });
});

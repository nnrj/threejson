import test from "node:test";
import assert from "node:assert/strict";
import { createViewportGizmoOverlay, getViewportGizmoOverlay } from "../tools/scene-host/shared/js/viewportGizmoOverlay.js";

test("orbit viewport gizmo skips incompatible walking/flying controls before allocating DOM or GPU resources", () => {
  for (const controls of [
    { threeJsonControlsKind: "firstPerson" },
    { threeJsonControlsKind: "fly", addEventListener() {}, removeEventListener() {} },
    { target: { isVector3: true }, removeEventListener() {} }
  ]) {
    assert.equal(createViewportGizmoOverlay({ camera: {}, renderer: {}, controls }, {}), null);
    assert.equal(getViewportGizmoOverlay(), null);
  }
});

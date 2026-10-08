import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorkspacePreferences } from "../tools/scene-host/video-editor/js/workbench.js";

test("video/code/mixed workspaces have independent non-document layout defaults", () => {
  const state = normalizeWorkspacePreferences();
  assert.equal(state.mode, "video");
  assert.equal(state.split, 50);
  assert.deepEqual(state.layouts.video, { library: true, inspector: true, timeline: true });
  assert.deepEqual(state.layouts.code, { library: false, inspector: false, timeline: false });
  assert.deepEqual(state.layouts.mixed, { library: false, inspector: true, timeline: true });
  state.layouts.code.timeline = true;
  assert.equal(normalizeWorkspacePreferences().layouts.code.timeline, false);
});

test("saved workspace preferences accept only supported modes and bounded sizes", () => {
  const value = { mode: "mixed", split: 999, layouts: { mixed: { inspector: false, timeline: "false" } } };
  const state = normalizeWorkspacePreferences(value);
  assert.equal(state.mode, "mixed");
  assert.equal(state.split, 75);
  assert.deepEqual(state.layouts.mixed, { library: false, inspector: false, timeline: true });
  assert.equal(value.split, 999);
  assert.equal(normalizeWorkspacePreferences({ mode: "arbitrary", split: -20 }).mode, "video");
  assert.equal(normalizeWorkspacePreferences({ split: -20 }).split, 25);
});

test("missing, obsolete and malformed optional preferences cannot break startup", () => {
  for (const value of [null, "legacy", 123, [], { split: Infinity }, { split: "45", layouts: null }]) {
    const result = normalizeWorkspacePreferences(value);
    assert.equal(result.mode, "video");
    assert.equal(result.split, 50);
  }
});

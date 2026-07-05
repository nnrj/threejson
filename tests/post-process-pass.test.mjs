import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  collectPassTargetIds,
  hasPassTargetIds
} from "../core/util/passTargetResolver.js";
import {
  normalizePassRecord,
  filterPassRecords,
  resolvePostProcessingConfig
} from "../core/handler/postProcessPassDeploy.js";
import {
  createPassRecordJson,
  ensureDefaultPassTypeFactories
} from "../core/builder/postProcessPassBuilder.js";
import {
  _clearPassListEntryExpandersForTests,
  registerPassListEntryExpander
} from "../core/handler/passListEntryRegistry.js";
import { expandPassListEntry as expandHighlightEntry } from "../domains/sceneHighlight/channels.js";
import { createSceneHighlightPassJson } from "../domains/sceneHighlight/channels.js";

describe("passTargetResolver", () => {
  it("merges threeJsonId and threeJsonIds uniquely", () => {
    const ids = collectPassTargetIds({
      threeJsonId: "a",
      threeJsonIds: ["b", "a"]
    });
    assert.deepEqual(ids, ["a", "b"]);
  });

  it("hasPassTargetIds is false when empty", () => {
    assert.equal(hasPassTargetIds({}), false);
  });
});

describe("normalizePassRecord", () => {
  beforeEach(() => {
    _clearPassListEntryExpandersForTests();
    registerPassListEntryExpander(expandHighlightEntry);
  });

  it("defaults passType to outline", () => {
    const record = normalizePassRecord({ objType: "pass" });
    assert.equal(record.passType, "outline");
  });

  it("strips target fields from render pass", () => {
    const record = normalizePassRecord({
      objType: "pass",
      passType: "render",
      threeJsonId: "x"
    });
    assert.equal(record.passType, "render");
    assert.equal(record.threeJsonId, undefined);
  });

  it("expands highlightChannel via registered expander", () => {
    const record = normalizePassRecord({
      highlightChannel: "alarm",
      threeJsonIds: ["dev-1"]
    });
    assert.equal(record.passType, "outline");
    assert.equal(record.visibleEdgeColor, "#DC3A2F");
    assert.equal(record.threeJsonIds[0], "dev-1");
    assert.equal(record.highlightChannel, undefined);
  });
});

describe("createSceneHighlightPassJson", () => {
  it("builds outline pass record for locate channel", () => {
    const record = createSceneHighlightPassJson({
      highlightChannel: "locate",
      threeJsonId: "cab-1"
    });
    assert.equal(record.objType, "pass");
    assert.equal(record.passType, "outline");
    assert.equal(record.visibleEdgeColor, "#E6A800");
    assert.equal(record.targetPolicy, "strict");
  });
});

describe("resolvePostProcessingConfig", () => {
  it("autoOutputPass defaults to true", () => {
    assert.equal(resolvePostProcessingConfig({}).autoOutputPass, true);
    assert.equal(
      resolvePostProcessingConfig({ postProcessing: { autoOutputPass: false } }).autoOutputPass,
      false
    );
  });
});

describe("filterPassRecords", () => {
  it("extracts only objType pass from objectList", () => {
    const passes = filterPassRecords([
      { objType: "box", name: "a" },
      { objType: "pass", passType: "render", id: "r1" }
    ]);
    assert.equal(passes.length, 1);
    assert.equal(passes[0].passType, "render");
  });
});

describe("createPassRecordJson", () => {
  it("returns canonical pass shape", () => {
    ensureDefaultPassTypeFactories();
    const record = createPassRecordJson({ passType: "outline", id: "p1" });
    assert.equal(record.objType, "pass");
    assert.equal(record.passType, "outline");
    assert.equal(record.targetPolicy, "strict");
  });
});

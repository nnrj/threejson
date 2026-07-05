import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCompatAdapter } from "../core/compat/index.js";
import {
  getThreeJsonCompatRevisions,
  getThreeJsonMinSupportedRevision,
  getThreeRevisionCompatibility,
  THREEJSON_MIN_SUPPORTED_REVISION,
  THREEJSON_PRIMARY_REVISION
} from "../core/compat/threeRevisionMatrix.js";

describe("threeRevisionMatrix r179 floor", () => {
  it("min supported revision is 179", () => {
    assert.equal(THREEJSON_MIN_SUPPORTED_REVISION, 179);
    assert.equal(getThreeJsonMinSupportedRevision(), 179);
  });

  it("compat revisions are 179 through primary", () => {
    const compat = getThreeJsonCompatRevisions();
    assert.deepEqual(compat, [179, 180, 181, 182, 183, 184]);
    assert.equal(compat[0], THREEJSON_MIN_SUPPORTED_REVISION);
    assert.equal(compat[compat.length - 1], THREEJSON_PRIMARY_REVISION);
  });

  it("r178 and below are unsupported", () => {
    assert.equal(getThreeRevisionCompatibility(178).tier, "unsupported");
    assert.equal(getThreeRevisionCompatibility(153).tier, "unsupported");
  });

  it("r179-183 are compat, r184 is native", () => {
    assert.equal(getThreeRevisionCompatibility(179).tier, "compat");
    assert.equal(getThreeRevisionCompatibility(183).tier, "compat");
    assert.equal(getThreeRevisionCompatibility(184).tier, "native");
  });
});

describe("getCompatAdapter segmentation (best-effort below r179)", () => {
  it("routes by revision regardless of matrix tier", () => {
    assert.equal(getCompatAdapter(153).id, "baseline153");
    assert.equal(getCompatAdapter(160).id, "r155lights");
    assert.equal(getCompatAdapter(170).id, "r169controls");
    assert.equal(getCompatAdapter(182).id, "r169controls");
    assert.equal(getCompatAdapter(184).id, "latest");
  });

  it("baseline153 down-converts physical point light on r153", () => {
    const adapter = getCompatAdapter(153);
    const intensity = adapter.resolveLightIntensity({
      type: "point",
      intensity: 28000,
      unit: "candela"
    });
    assert.equal(intensity, 1);
  });
});

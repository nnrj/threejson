import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHelpersConfig,
  canonicalizeHelpersForSceneConfig
} from "../core/builder/sceneHelperBuilder.js";
import {
  contourHasSelfIntersection,
  parseContour2D,
  resolveShapeSelfIntersectMode
} from "../core/builder/shapeGeometryUtil.js";
import { validateBufferMeshStats, BUFFER_MESH_MAX_VERTICES } from "../core/builder/bufferMeshLimits.js";
import { resolveIrregularPlaneRecord } from "../core/builder/irregularShapeResolver.js";
import { resolveIrregularGeometryRecord } from "../core/builder/irregularShapeResolver.js";

test("normalizeHelpersConfig maps gridHelper alias", () => {
  const cfg = normalizeHelpersConfig({}, { gridHelper: { visible: true, size: 80 } });
  assert.ok(cfg?.grid);
  assert.equal(cfg.grid.size, 80);
});

test("normalizeHelpersConfig prefers helpers.grid over gridHelper alias", () => {
  const cfg = normalizeHelpersConfig(
    { helpers: { grid: { size: 100 } } },
    { gridHelper: { size: 80 } }
  );
  assert.equal(cfg?.grid?.size, 100);
});

test("normalizeHelpersConfig prefers sceneConfig over worldInfo", () => {
  const cfg = normalizeHelpersConfig(
    { gridHelper: { size: 50 } },
    { gridHelper: { size: 80 } }
  );
  assert.equal(cfg?.grid?.size, 50);
});

test("canonicalizeHelpersForSceneConfig strips unknown keys shape", () => {
  const out = canonicalizeHelpersForSceneConfig({
    grid: { size: 10 },
    axes: { size: 5 }
  });
  assert.equal(out.grid.size, 10);
  assert.equal(out.axes.size, 5);
});

test("contourHasSelfIntersection detects bow-tie", () => {
  const bow = parseContour2D([[0, 0], [10, 10], [10, 0], [0, 10]]);
  assert.equal(contourHasSelfIntersection(bow), true);
  const rect = parseContour2D([[0, 0], [10, 0], [10, 5], [0, 5]]);
  assert.equal(contourHasSelfIntersection(rect), false);
});

test("resolveShapeSelfIntersectMode defaults reject", () => {
  assert.equal(resolveShapeSelfIntersectMode({}), "reject");
  assert.equal(resolveShapeSelfIntersectMode({ shapeValidation: { selfIntersect: "warn" } }), "warn");
});

test("validateBufferMeshStats rejects excess vertices", () => {
  const bad = validateBufferMeshStats({
    vertexCount: BUFFER_MESH_MAX_VERTICES + 1,
    triangleCount: 3,
    maxIndex: 2
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "E_BUFFER_MESH_LIMIT_EXCEEDED");
});

test("resolveIrregularPlaneRecord shape default", () => {
  const rec = resolveIrregularPlaneRecord({
    objType: "irregularPlane",
    shape: { contour: [[0, 0], [1, 0], [0, 1]] }
  });
  assert.equal(rec.objType, "shapePlane");
});

test("resolveIrregularPlaneRecord rect delegates plane", () => {
  const rec = resolveIrregularPlaneRecord({
    objType: "irregularPlane",
    planeKind: "rect",
    geometry: { width: 10, height: 5 }
  });
  assert.equal(rec.objType, "plane");
});

test("resolveIrregularGeometryRecord shapeExtrude default", () => {
  const rec = resolveIrregularGeometryRecord({
    objType: "irregularGeometry",
    shape: { contour: [[0, 0], [2, 0], [2, 1], [0, 1]] },
    extrude: { depth: 3 }
  });
  assert.equal(rec.objType, "shapeExtrude");
});

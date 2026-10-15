import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Scene, PerspectiveCamera } from "three";
import { evaluateProceduralMeshGeometry } from "../core/geometry/proceduralMeshGeometry.js";
import { geometryInputRecord } from "../core/geometry/geometryInput.js";
import { serializeGeometryResult, deserializeGeometryResult } from "../core/geometry/geometryTransfer.js";
import { collectAssetsFromPayload } from "../core/util/archiveExportUtil.js";
import { createRenderLoop } from "../core/handler/frameLoopHandler.js";
import { createPreviewPerformance, resolvePreviewBudget, FULL_PREVIEW_BUDGET } from "../core/runtime/previewPerformance.js";
import { createHostPreviewPerformance } from "../tools/scene-host/shared/js/previewPerformancePolicy.js";
import { runCreationQualityReview } from "../core/ai/creationQuality.js";
import { formatQualityReport, resolveCreationQuality } from "../tools/scene-host/shared/js/creationQualityPolicy.js";
import { createSceneHostGeometryCompiler } from "../tools/scene-host/shared/js/sceneGeometryCompiler.js";

test("SDF samples above the old 2M ceiling reach evaluation unless the caller limits them", () => {
  let sampled = 0;
  const geometry = { resolution: 129, get values() { sampled++; throw new Error("sampling-sentinel"); } };
  const record = { objType: "implicitSurface", geometry };
  assert.match(evaluateProceduralMeshGeometry(record).error, /sampling-sentinel/);
  assert.equal(sampled, 1);
  assert.match(evaluateProceduralMeshGeometry(record, { meshBudget: { maxSamples: 129 ** 3 } }).error, /sampling-sentinel/);
  const limited = evaluateProceduralMeshGeometry(record, { meshBudget: { maxSamples: 100 } });
  assert.equal(limited.code, "E_BUFFER_MESH_BUDGET_EXCEEDED"); assert.equal(sampled, 2);
  assert.equal(evaluateProceduralMeshGeometry({ objType: "implicitSurface", geometry: { resolution: 2 ** 53 } }).code, "E_PROCEDURAL_ALLOCATION_RANGE");
});

test("grid budgets fail before sampling, and explicit caller budgets override descriptor limits", () => {
  const record = { objType: "parametricSurface", meshBudget: {}, geometry: { uSegments: 32, vSegments: 32, expressions: { x: "invalid_symbol", y: "u", z: "v" } } };
  const result = evaluateProceduralMeshGeometry(record, { meshBudget: { maxVertices: 10 } });
  assert.equal(result.code, "E_BUFFER_MESH_BUDGET_EXCEEDED"); assert.match(result.error, /vertices/);
  const valid = { ...record, meshBudget: { maxVertices: 1 }, geometry: { ...record.geometry, uSegments: 1, vSegments: 1, expressions: { x: "u", y: "v", z: "0" } } };
  const unlimited = evaluateProceduralMeshGeometry(valid, { meshBudget: {} });
  assert.ok(unlimited.geometry, unlimited.error); unlimited.geometry.dispose();
});

test("adaptive precision honors maxSegments above 256 and reports unmet tolerance", () => {
  const record = { objType: "bezierPatch", controlPoints: [[[0,0,0],[.5,0,1],[1,0,0]],[[0,1,0],[.5,1,1],[1,1,0]]], uSegments: 1, vSegments: 1, tessellation: { maxError: 1e-15, maxSegments: 257 } };
  const result = evaluateProceduralMeshGeometry(geometryInputRecord(record));
  assert.ok(result.geometry, result.error);
  assert.equal(result.geometry.userData.tessellation.uSegments, 257);
  assert.equal(result.geometry.userData.tessellation.converged, false);
  const transferred = deserializeGeometryResult(serializeGeometryResult(result).result);
  assert.deepEqual(transferred.geometry.userData.tessellation, result.geometry.userData.tessellation);
  transferred.geometry.dispose(); result.geometry.dispose();
});

test("browser geometry limits are caller-owned and survive worker fallback", async () => {
  const record = { objType: "parametricSurface", meshBudget: {}, geometry: { uSegments: 1500, vSegments: 1500, expressions: { x: "u", y: "v", z: "0" } } };
  await assert.rejects(createSceneHostGeometryCompiler().compile(record), { code: "E_BUFFER_MESH_BUDGET_EXCEEDED" });
  const small = { ...record, geometry: { ...record.geometry, uSegments: 1, vSegments: 1 } };
  const custom = createSceneHostGeometryCompiler({ meshBudget: { maxVertices: 3 } });
  await assert.rejects(custom.compile(small), { code: "E_BUFFER_MESH_BUDGET_EXCEEDED" });
  const result = await custom.compile(small, { meshBudget: {} });
  assert.equal(result.geometry.attributes.position.count, 4); result.geometry.dispose();
});

test("required archive resources use explicit policy, not service-shaped URLs", async () => {
  const refs = ["https://assets.test/v1/models/objects/" + "a".repeat(64), "https://assets.test/model.glb"];
  for (const ref of refs) {
    const payload = { objectList: [{ objType: "externalModel", modelPath: ref }] };
    assert.equal((await collectAssetsFromPayload(payload)).payload.objectList[0].modelPath, ref);
    await assert.rejects(collectAssetsFromPayload(payload, { requiredAssets: [ref] }), { code: "ARCHIVE_REQUIRED_ASSET_UNAVAILABLE", ref });
    await assert.rejects(collectAssetsFromPayload(payload, { isAssetRequired: ({ key }) => key === "modelPath", resolveAsset() { throw new Error("offline"); } }), error => error.code === "ARCHIVE_REQUIRED_ASSET_UNAVAILABLE" && error.cause.message === "offline");
  }
});

test("ordinary render loops keep the shared unlimited sentinel and never initialize a preview", () => {
  let frames = 0;
  const loop = createRenderLoop({ scene: new Scene(), camera: new PerspectiveCamera(), renderer: { render() { frames++; } }, config: { autoResize: false, firstAutoResize: false } });
  assert.equal(loop.previewPerformance, FULL_PREVIEW_BUDGET);
  loop.renderCurrentFrame(); assert.equal(frames, 1); loop.dispose();
  assert.throws(() => resolvePreviewBudget("economy"), /numeric limits/);
});

test("host auto budgets preserve content by default and recover with hysteresis", () => {
  const policy = createHostPreviewPerformance("auto", { device: { navigator: {}, coarsePointer: false }, samples: 2, downWindows: 2, upWindows: 3 });
  assert.equal(policy.mode, "full");
  const sample = ms => policy.onFrame({ workTimeMs: ms, frameIntervalMs: ms, realtime: true });
  sample(40); sample(40); assert.equal(policy.mode, "full");
  sample(40); sample(40); assert.equal(policy.mode, "balanced");
  assert.equal(policy.getBudget().maxPoints, Infinity); assert.equal(policy.getBudget().lodBias, 1);
  for (let i = 0; i < 5; i++) sample(16); assert.equal(policy.mode, "balanced");
  sample(16); assert.equal(policy.mode, "full");
  for (let i = 0; i < 10; i++) sample(1000); assert.equal(policy.mode, "full");
  for (let i = 0; i < 10; i++) policy.onFrame({ workTimeMs: 40, realtime: false }); assert.equal(policy.mode, "full");
  assert.equal(createHostPreviewPerformance("full"), undefined);
});

test("numeric preview budgets recover original renderer/composer DPR and respect later host changes", () => {
  let budget = { maxPixelRatio: .5 };
  const policy = createPreviewPerformance({ getBudget: () => budget });
  const renderer = { ratio: 2, getSize: v => v.set(200,100), getPixelRatio() { return this.ratio; }, setPixelRatio(v) { this.ratio = v; } };
  const composer = { _pixelRatio: 1.5, setPixelRatio(v) { this._pixelRatio = v; } };
  const draw = () => policy.draw(new Scene(), null, renderer, composer, () => {});
  draw(); assert.equal(renderer.ratio, .5); assert.equal(composer._pixelRatio, .5);
  budget = {}; draw(); assert.equal(renderer.ratio, 2); assert.equal(composer._pixelRatio, 1.5);
  budget = { maxPixelRatio: .5 }; draw(); renderer.ratio = 3; draw(); policy.dispose();
  assert.equal(renderer.ratio, 3); assert.equal(composer._pixelRatio, 1.5);
});

test("generic quality review accepts custom profiles, separates coverage and keeps display outside core", async () => {
  let reviews = 0;
  const profile = { id: "my-pipeline", repairRounds: 0, reviewVisual: true };
  const options = { profile, inspect: () => ({ available: true, warnings: [], views: [{ dataUrl: "data:image/png;base64,test" }] }), review: () => { reviews++; return { satisfied: true, issues: [] }; } };
  const unavailable = (await runCreationQualityReview({}, { ...options, visionAvailable: false })).report;
  assert.equal(unavailable.completed, false); assert.equal(unavailable.checksComplete, false); assert.equal(reviews, 0);
  const passed = (await runCreationQualityReview({}, { ...options, visionAvailable: true })).report;
  assert.equal(reviews, 1); assert.equal(passed.completed, true); assert.equal(passed.coverage.visual, "sampled");
  assert.match(formatQualityReport(passed, "zh-CN"), /采样/); assert.match(formatQualityReport(passed, "en-US"), /sampled/);
  assert.equal(resolveCreationQuality("ultimate", { repairRounds: 8 }).repairRounds, 8);
});

test("core source cannot grow product quotas, device heuristics, service URL special cases or report UI", () => {
  const read = path => readFileSync(new URL(`../core/${path}`, import.meta.url), "utf8");
  assert.doesNotMatch(read("runtime/previewPerformance.js"), /deviceMemory|hardwareConcurrency|navigator|matchMedia|balanced|economy/);
  assert.doesNotMatch(read("ai/creationQuality.js"), /CREATION_QUALITY_PROFILES|formatQualityReport|[\u4e00-\u9fff]/);
  assert.doesNotMatch(read("util/archiveExportUtil.js"), /v1[^\n]{0,40}models/);
  assert.doesNotMatch(read("geometry/proceduralMeshGeometry.js"), /2000000|2097152|Math\.min\(256/);
});

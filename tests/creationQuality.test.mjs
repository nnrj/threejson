import test from "node:test";
import assert from "node:assert/strict";
import { runCreationQualityReview, providerSupportsVision, bindStoredQualityReport, verifyStoredQualityReport } from "../core/ai/creationQuality.js";
import { resolveCreationQuality } from "../tools/scene-host/shared/js/creationQualityPolicy.js";
import { createCreationBudget } from "../packages/host-kit/js/creationBudget.js";
import { createSceneSession, createSceneOperationService } from "../core/session.js";
import { createCommandContext, executeCommands } from "../core/command/index.js";
import { createFramingCamera } from "../core/theme/visualRecipes.js";
import { mediaReviewSamples, reviewSceneResult } from "../packages/host-kit/js/sceneQualityReview.js";
import { collectAssetsFromPayload } from "../core/util/archiveExportUtil.js";
import { fetchPersistedModelBlob, isRequiredModelAsset } from "../tools/scene-host/shared/js/modelAssetResources.js";

const scene = () => ({ objectList: [{ objType: "sphere", threeJsonId: "hero", geometry: { radius: 1 } }] });
test("unavailable renderer never passes a final quality gate", async () => {
  const result = await runCreationQualityReview(scene());
  assert.equal(result.report.completed, false);
  assert.equal(result.report.structural, "unchecked");
  assert.equal(result.report.stopReason, "quality_inspection_unavailable");
});
test("an explicit disabled video review forbids additional image requests", async () => {
  const film = { documentType: "composition", timeline: { clips: [] }, scenes: {} };
  const result = await reviewSceneResult({ sceneJson: film, sceneJsonString: JSON.stringify(film) }, {
    creationQuality: "standard", videoOptions: { visualReview: "disabled" },
    providerOptions: { capabilities: { inputModalities: ["text", "image"] } },
    inspectSceneQuality: () => ({ available: true, warnings: [], views: [{dataUrl:"data:image/png;base64,x"}] }),
    qualityRequest() { assert.fail("Explicit opt-out must prevent a visual review request"); }
  });
  assert.equal(result.qualityReport.visual, "not-requested");
});
test("model archives are self-contained and missing required model bytes fail clearly", async () => {
  const url = `https://assets.test/v1/models/objects/${"a".repeat(64)}`;
  const gltf = { asset: { version: "2.0" }, buffers: [{uri:"data:application/octet-stream;base64,YWJjZA==",byteLength:4}] };
  const payload = { objectList: [{ objType: "externalModel", modelFileType: "gltf", modelPath: url }] };
  const resolveAsset = ref => fetchPersistedModelBlob(ref, { fetchImpl: async (_url, options) => {
    assert.equal(options.credentials, "omit"); assert.equal(options.headers, undefined);
    return new Response(JSON.stringify(gltf), { headers: { "Content-Type":"model/gltf+json" } });
  } });
  const packed = await collectAssetsFromPayload(payload, {resolveAsset});
  assert.match(packed.payload.objectList[0].modelPath, /^pack:\/\//);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(Object.values(packed.assets)[0])), gltf);
  await assert.rejects(collectAssetsFromPayload(payload, { isAssetRequired: isRequiredModelAsset }), { code: "ARCHIVE_REQUIRED_ASSET_UNAVAILABLE" });
});
test("quality defaults to quick; vision is declared, never inferred from model names", () => {
  assert.equal(resolveCreationQuality().id, "quick");
  assert.equal(providerSupportsVision({ provider: "chatgpt", model: "gpt-4o" }), false);
  assert.equal(providerSupportsVision({ capabilities: { inputModalities: ["text", "image"] } }), true);
});

test("paused drafts receive local checks without restarting a supplied paid refinement profile", async () => {
  const source = scene();
  const result = await reviewSceneResult({ sceneJson: source, sceneJsonString: JSON.stringify(source), agentResult: { completed: false, stopReason: "paused" } }, {
    creationQuality: "ultimate", qualityProfile: resolveCreationQuality("ultimate"),
    providerOptions: { capabilities: { inputModalities: ["text", "image"] } },
    inspectSceneQuality: (_document, { profile }) => {
      assert.equal(profile.repairRounds, 0); assert.equal(profile.reviewVisual, false);
      return { available: true, warnings: [], views: [{ dataUrl: "data:image/png;base64,x" }] };
    },
    qualityRequest() { assert.fail("An unfinished generation must not receive a new paid review budget"); }
  });
  assert.equal(result.agentResult.completed, false); assert.equal(result.agentResult.stopReason, "paused");
  assert.equal(result.qualityReport.visual, "not-requested");
});
test("quick performs local checks without a separate paid review", async () => {
  let inspected = 0;
  const result = await runCreationQualityReview(scene(), { inspect: () => { inspected++; return { available: true, warnings: [], views: [{ dataUrl: "data:image/png;base64,x" }] }; }, visionAvailable: true, review() { throw new Error("must not be called"); } });
  assert.equal(inspected, 1); assert.equal(result.report.visual, "not-requested"); assert.equal(result.report.messageCode, "QUALITY_STRUCTURAL_ONLY");
});
test("tiers enforce repair limits and bind the last report to the actual last revision", async () => {
  for (const [profile, rounds] of [["standard", 1], ["fine", 2], ["ultimate", 3]]) {
    const original = scene();
    const result = await runCreationQualityReview(original, { profile: resolveCreationQuality(profile), visionAvailable: true,
      inspect: () => ({ available: true, views: [{ dataUrl: "data:image/png;base64,x" }], warnings: [] }),
      review: () => ({ satisfied: false, issues: [{ severity: "error", code: "SUBJECT_CROPPED", message: "Subject is cropped" }] }),
      repair: doc => ({ ...doc, attempt: (doc.attempt || 0) + 1 }), validate: () => true });
    assert.equal(result.report.repairs, rounds); assert.equal(result.report.completed, false); assert.equal(result.document.attempt, rounds);
    assert.equal(original.attempt, undefined);
    const saved = await bindStoredQualityReport(result.report, result.document);
    assert.equal((await verifyStoredQualityReport(saved, result.document)).stale, undefined);
    assert.equal((await verifyStoredQualityReport(saved, { ...result.document, name: "edited" })).stale, true);
  }
});
test("invalid repairs and provider failures retain the previously valid document", async () => {
  const original = scene();
  const result = await runCreationQualityReview(original, { profile: resolveCreationQuality("fine"), inspect: () => ({ available: true, warnings: [{ severity: "error", code: "FRAME" }] }), repair: () => ({ broken: true }), validate: () => false });
  assert.deepEqual(result.document, original); assert.equal(result.report.stopReason, "quality_repair_invalid");
  const noVision = await runCreationQualityReview(original, { profile: resolveCreationQuality("fine"), inspect: () => ({ available: true, views: [1] }), visionAvailable: false, review() { assert.fail(); } });
  assert.equal(noVision.report.visual, "unavailable"); assert.equal(noVision.report.messageCode, "QUALITY_STRUCTURAL_ONLY"); assert.equal(noVision.report.completed, false);
});
test("a single budget ledger spans generation/review/repair and preserves stricter deadlines", () => {
  const ledger = createCreationBudget({ modelBudget: { maxTokens: 100, maxRequests: 2, maxTimeMs: 1000 } });
  ledger.begin({ maxTokens: 40 }); ledger.observe({ usage: { total_tokens: 40 } });
  assert.equal(ledger.requestOptions({}, 200).maxTokens, 60);
  const earlier = Date.now() + 50;
  assert.equal(ledger.requestOptions({ turnDeadlineAt: earlier }).turnDeadlineAt, earlier);
  ledger.begin({}); ledger.observe({ usage: { total_tokens: 50 } });
  assert.throws(() => ledger.begin({}), /次数预算/);
  const costs = createCreationBudget({ modelBudget: { maxCost: 1 } }); costs.observe({ usage: { total_tokens: 10 } });
  assert.throws(() => costs.requestOptions({}), /无法核算|没有返回/);
});
test("lighting/material/framing commands persist ordinary JSON and undo atomically", async () => {
  const session = createSceneSession(scene()), service = createSceneOperationService({ session });
  const before = session.snapshot();
  const receipt = await service.execute([
    { op: "look.apply", args: { preset: "product", center: [100, 2, 0], size: 4 } },
    { op: "material.recipe", args: { id: "hero", preset: "brushedMetal" } },
    { op: "camera.frame", args: { bounds: { min: [99, 1, -1], max: [101, 3, 1] }, aspect: .5 } }
  ]);
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.equal(session.document.root.objectList.length, 1); assert.equal(session.document.root.objectList[0].material.metalness, 1);
  assert.equal(session.document.root.sceneConfig.scene.environment.type, "studio");
  assert.equal(session.document.root.sceneConfig.camera.lookAt.x, 100);
  await service.undo(); assert.deepEqual(session.document.root, before.root);
  await service.redo(); assert.equal(session.document.root.sceneConfig.renderer.outputColorSpace, "srgb");
  const ctx = createCommandContext({ options: { session } });
  // The operation registry is discoverable from the legacy command bridge too.
  const checked = await executeCommands(ctx, [{ op: "look.apply", args: { preset: "night" } }], { dryRun: true });
  assert.equal(checked.ok, true, JSON.stringify(checked)); session.dispose();
});
test("portrait framing is farther back and long-video sampling stays bounded without modifying clips", () => {
  const bounds = { min: [-1,-1,-1], max: [1,1,1] };
  assert.ok(createFramingCamera({ bounds, aspect: .5 }).position.z > createFramingCamera({ bounds, aspect: 2 }).position.z);
  const document = { timeline: { clips: Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, start: i * 10, duration: 10 })) } };
  const samples = mediaReviewSamples(document, resolveCreationQuality("ultimate"));
  assert.equal(samples.length, 96); assert.equal(document.timeline.clips.length, 100); assert.ok(samples.at(-1).time > 990);
});

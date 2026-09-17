import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectEditorParticleMigration, describeEditorParticleMigration } from "../tools/scene-host/editor/js/editorLegacyParticleMigration.js";
import { formatEditorSceneImportError, prepareEditorSceneImport, runEditorSceneImport } from "../tools/scene-host/editor/js/editorSceneImport.js";
import { createEditorConfirmModal } from "../tools/scene-host/editor/js/editorConfirmModal.js";
import { createJsonScene } from "../core/handler/sceneLoadHandler.js";
import { resolveScenePayloadForLoad } from "../core/builder/nativeObjectLoader.js";
import { parseSceneJsonString } from "../core/handler/sceneJsonParser.js";
import { isLoadableScenePayload } from "../core/handler/sceneFriendlyNormalizer.js";
import { collectSceneCapabilityDiagnostics } from "../core/capabilities/sceneCapabilityValidation.js";
import { compileAuthoring, formatAuthoring } from "../core/document/authoringAdapters.js";

const legacyParticle = () => ({ objType: "particleEmitter", name: "starfield", threeJsonId: "stars",
  position: { x: 0, y: 80, z: 0 }, simulation: "cpu", material: { color: "#ffffff", size: 1.5, opacity: 0.9 } });
const friendly = () => ({ version: "next", name: "legacy-scene", threeJsonId: "scene",
  sceneConfig: { scene: { background: "#1a1a2e" }, lights: [{ type: "ambient", intensity: 2 }] },
  worldInfo: { objectList: [{ objType: "box", threeJsonId: "box", material: { color: "red" } }, legacyParticle()] } });

test("legacy particle conversion is explicit, copy-only, and lists the missing defaults", async () => {
  const original = friendly(), before = structuredClone(original);
  const report = inspectEditorParticleMigration(original);
  assert.equal(report.needed, true);
  assert.deepEqual(report.issues, []);
  assert.notEqual(report.payload, original);
  assert.deepEqual(original, before);
  const particle = report.payload.worldInfo.objectList[1];
  assert.equal(particle.simulation.backend, "cpu");
  assert.equal(particle.render.color, "#ffffff");
  assert.equal(particle.render.size, 1.5);
  assert.equal(particle.render.opacity, 0.9);
  assert.equal(particle.emission.count, 1000);
  assert.deepEqual(particle.source, { type: "box", width: 100, height: 100, depth: 100 });
  assert.equal("material" in particle, false);
  assert.deepEqual(report.payload.worldInfo.objectList[0], original.worldInfo.objectList[0]);
  assert.deepEqual(report.payload.sceneConfig, original.sceneConfig);
  assert.deepEqual(particle.position, before.worldInfo.objectList[1].position);
  assert.equal(report.payload.version, "next");
  const message = describeEditorParticleMigration(report);
  for (const detail of ["starfield", "1000", "100 × 100 × 100", "原文件不会被覆盖", "外观完全一致"]) assert.ok(message.includes(detail));
  assert.deepEqual(collectSceneCapabilityDiagnostics(report.payload), []);
  const runtime = await createJsonScene(report.payload);
  try {
    const points = runtime.scene.getObjectByName("starfield");
    assert.equal(points.isPoints, true);
    assert.equal(points.geometry.getAttribute("position").count, 1000);
    const saved = formatAuthoring(compileAuthoring(report.payload), { format: "friendly" });
    assert.equal(inspectEditorParticleMigration(saved).needed, false);
    const reloaded = await createJsonScene(saved);
    assert.equal(reloaded.scene.getObjectByName("starfield").isPoints, true);
    await reloaded.dispose();
  } finally { await runtime.dispose(); }
});

test("standard, nested and single-object imports migrate without touching opaque metadata", () => {
  const payload = { objectList: [{ objType: "group", children: [legacyParticle()] }], metadata: { example: legacyParticle() }, userData: { record: legacyParticle() } };
  const report = inspectEditorParticleMigration(payload);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].path, "/objectList/0/children/0");
  assert.deepEqual(report.payload.metadata, payload.metadata);
  assert.deepEqual(report.payload.userData, payload.userData);
  assert.equal(inspectEditorParticleMigration(legacyParticle()).entries[0].path, "/");
});

test("ordinary friendly JSON and current V2 need no conversion or confirmation", async () => {
  for (const payload of [{ version: "next", worldInfo: { boxModelList: [{ name: "cube" }] } },
    { objectList: [{ objType: "particleEmitter", simulation: { backend: "cpu" }, source: { type: "sphere", radius: 5 }, render: { size: 2 } }] }]) {
    const report = inspectEditorParticleMigration(payload);
    assert.equal(report.needed, false);
    assert.equal(report.payload, payload);
    const ready = await prepareEditorSceneImport(payload, () => assert.fail("unnecessary dialog"));
    assert.equal(ready.payload, payload);
  }
});

test("known count, URL, bounds and position mappings do not truncate or acquire resources", () => {
  const particle = { ...legacyParticle(), count: 600001, distribution: "box", bounds: { width: 40, height: 60, depth: 80 } };
  particle.material.map = "https://example.invalid/sprite.png";
  const report = inspectEditorParticleMigration(particle);
  assert.deepEqual(report.issues, []);
  assert.equal(report.payload.emission.count, 600001);
  assert.equal(report.payload.render.map, particle.material.map);
  assert.deepEqual(report.payload.source, { type: "box", width: 40, height: 60, depth: 80 });
  const positions = inspectEditorParticleMigration({ ...legacyParticle(), positions: [[1, 2, 3], { x: 4, y: 5, z: 6 }] });
  assert.equal(positions.payload.source.type, "positions");
  assert.equal(positions.payload.emission.count, 2);
  const sphere = inspectEditorParticleMigration({ ...legacyParticle(), count: 100, distribution: { type: "sphere", radius: 8, innerRadius: 2 } });
  assert.deepEqual(sphere.payload.source, { type: "sphere", radius: 8, innerRadius: 2 });
});

for (const [label, extra] of [
  ["unknown motion", { motion: { type: "drift" } }],
  ["legacy velocity", { velocity: { y: 3 } }],
  ["third-party provider", { provider: "nebula" }],
  ["GPU alias", { simulation: "gpuCompute" }],
  ["different shell sampling", { distribution: "shell" }],
  ["mixed source", { source: { type: "box" }, distribution: "sphere" }],
  ["material conflict", { render: { color: "red" } }],
  ["count conflict", { count: 5, emission: { count: 7 } }],
  ["unsupported material data", { material: { shader: "custom" } }],
  ["invalid coordinates", { positions: [[1, 2, Infinity]] }],
  ["coordinate count mismatch", { positions: [[1, 2, 3]], count: 2 }],
  ["conflicting distribution dimensions", { distribution: { type: "box", width: 3 }, bounds: { width: 4 } }],
  ["unsupported geometry", { geometry: { radius: 6, segments: 20 } }],
  ["top-level legacy radius", { radius: 5 }]
]) test(`migration refuses ${label} instead of losing or guessing data`, async () => {
  const payload = { objectList: [legacyParticle(), { ...legacyParticle(), name: "unsupported", ...extra }] };
  const before = structuredClone(payload), report = inspectEditorParticleMigration(payload);
  assert.ok(report.issues.length > 0);
  assert.equal(report.payload, payload, "conversion must be all-or-nothing");
  assert.deepEqual(payload, before);
  await assert.rejects(prepareEditorSceneImport(payload, () => assert.fail("must not offer a lossy conversion")),
    (error) => error.code === "E_EDITOR_IMPORT_MIGRATION" && error.message.includes("unsupported"));
});

test("conversion denial does not call the loader or mutate the original", async () => {
  const payload = friendly(), before = structuredClone(payload);
  const result = await prepareEditorSceneImport(payload, async (_, options) => {
    assert.equal(options.confirmLabel, "转换副本并导入");
    return false;
  });
  assert.deepEqual(result, { status: "cancelled" });
  assert.deepEqual(payload, before);
});

function feedback() {
  const events = [];
  return { events, showMessage: (...args) => events.push(args), stopLoading: () => events.push("stop"), onError: (e) => events.push(e) };
}
test("load errors retain diagnostics and are never reported as cancellation", async () => {
  const out = feedback();
  const error = Object.assign(new Error("unavailable"), { diagnostics: [{ pointer: "/objectList/0/simulation", reason: "Unsupported particle backend" }] });
  const result = await runEditorSceneImport(async () => { throw error; }, out);
  assert.equal(result.status, "failed");
  assert.equal(result.error, error);
  assert.match(out.events[1][0], /objectList\/0\/simulation/);
  assert.equal(out.events[1][1], "error");
  assert.ok(!JSON.stringify(out.events).includes("已取消"));
});
test("only explicit cancellation gets the cancellation message and closes the mask", async () => {
  const out = feedback();
  assert.equal((await runEditorSceneImport(async () => ({ status: "cancelled" }), out)).status, "cancelled");
  assert.deepEqual(out.events, ["stop", ["已取消导入。", "info"]]);
});
test("superseded and aborted loads cannot overwrite newer feedback or hide its mask", async () => {
  for (const operation of [async () => ({ status: "loaded" }), async () => { throw new Error("late error"); }]) {
    const out = feedback();
    assert.equal((await runEditorSceneImport(operation, { ...out, isCurrent: () => false })).status, "superseded");
    assert.deepEqual(out.events, []);
  }
  const out = feedback();
  assert.equal((await runEditorSceneImport(async () => { throw new DOMException("replaced", "AbortError"); }, out)).status, "superseded");
  assert.deepEqual(out.events, ["stop"]);
});
test("parse, unsupported version and resource errors have distinct useful descriptions", () => {
  assert.match(formatEditorSceneImportError(new SyntaxError("Unexpected end at position 180")), /JSON.*180/);
  assert.match(formatEditorSceneImportError(new Error("Generated scene JSON must contain worldInfo")), /文件格式/);
  assert.match(formatEditorSceneImportError(Object.assign(new Error("99"), { code: "UNSUPPORTED_SCHEMA_VERSION" })), /不支持此场景文档版本.*99/);
  assert.equal(formatEditorSceneImportError(new Error("texture fetch failed")), "导入失败：texture fetch failed");
});

// Exercise the actual editor integration function with injected UI/runtime dependencies. This
// catches accidental reintroduction of false -> cancelled in callers without requiring WebGL.
const app = readFileSync(new URL("../tools/scene-host/editor/js/editorApp.js", import.meta.url), "utf8");
const extract = (start, end) => app.slice(app.indexOf(`  async function ${start}(`), app.indexOf(`  ${end}`, app.indexOf(`  async function ${start}(`)));
function editorHarness({ failLoad = false, confirm = true, flags = {} } = {}) {
  const old = { objectList: [{ objType: "box", name: "current" }] }, config = { jsonData: old }, out = feedback();
  const counters = { loaded: 0, snapshotsCleared: 0, format: 0 };
  const dependencies = {
    suppressCanvasDirty: { runAsync: (fn) => fn() }, resolveScenePayloadForLoad, isLoadableScenePayload,
    prepareEditorSceneImport, runEditorSceneImport, confirmSceneMigration: async () => confirm,
    resolveEditorRuntimeFlags: async () => flags, editorSettings: {}, modalUi: {},
    viewPreserve: null, authoringSession: null, camera: null, controls: null, ensureThreeJsonIdsOnScenePayload() {},
    sysConfig: config, subInit: async () => { counters.loaded++; if (failLoad) throw new Error("GPU unavailable"); },
    completeIngestAfterRuntime: async () => true,
    scenePayloadFormat: { recordEditorScenePayloadViewFormat() { counters.format++; } },
    editorSessionRecovery: { clearAutoSnapshotOnNewIngest() { counters.snapshotsCleared++; } },
    rightSidebarCache: null, sceneImportFeedback: () => out
  };
  const create = new Function(...Object.keys(dependencies), `let sceneLoadGeneration = 0, pendingCreateJsonSceneFlags;
    ${extract("ingestScenePayload", "function sceneImportFeedback(")}
    return ingestScenePayload;`);
  return { ingest: create(...Object.values(dependencies)), config, old, out, counters };
}
test("editor load failure preserves document and recovery; successful conversion commits its copy", async () => {
  const failed = editorHarness({ failLoad: true });
  assert.equal(await failed.ingest(friendly()), false);
  assert.equal(failed.config.jsonData, failed.old);
  assert.equal(failed.counters.snapshotsCleared, 0);
  assert.equal(failed.counters.format, 0);
  assert.match(failed.out.events[1][0], /GPU unavailable/);
  const ok = editorHarness(), original = friendly();
  assert.equal(await ok.ingest(original), true);
  assert.notEqual(ok.config.jsonData, original);
  assert.equal(ok.config.jsonData.worldInfo.objectList[1].simulation.backend, "cpu");
  assert.equal(ok.counters.snapshotsCleared, 1);
  assert.equal(original.worldInfo.objectList[1].simulation, "cpu");
});
test("declining conversion or runtime options leaves the old scene and recovery untouched", async () => {
  for (const options of [{ confirm: false }, { flags: null }]) {
    const harness = editorHarness(options);
    assert.equal(await harness.ingest(friendly()), false);
    assert.equal(harness.counters.loaded, 0);
    assert.equal(harness.counters.snapshotsCleared, 0);
    assert.equal(harness.config.jsonData, harness.old);
    assert.deepEqual(harness.out.events, ["stop", ["已取消导入。", "info"]]);
  }
});
test("actual JSON file handler does not replace load errors with cancellation or success", async () => {
  const harness = editorHarness({ failLoad: true }), messages = [];
  const dependencies = { openOrCloseProgressManager() {}, sysConfig: {},
    ui: { setLoadingMessage() {}, setLoading() {}, showMessage: (...args) => messages.push(args) },
    isSingleObjectJsonImport: () => false, isThreeJsObjectExportJson: () => false,
    parseSceneJsonString, ingestScenePayload: harness.ingest, formatEditorSceneImportError, console: { error() {} }
  };
  const handle = new Function(...Object.keys(dependencies), `${extract("handleLocalSceneJsonFile", "async function importSingleObjectRecordJson(")} return handleLocalSceneJsonFile;`)(...Object.values(dependencies));
  await handle({ name: "old.json", text: async () => JSON.stringify(friendly()) }, { skipDirtyConfirm: true });
  assert.deepEqual(messages, []);
  assert.equal(harness.out.events[1][1], "error");
  await handle({ name: "broken.json", text: async () => '{"broken":' }, { skipDirtyConfirm: true });
  assert.equal(messages.at(-1)[1], "error");
  assert.match(messages.at(-1)[0], /文件格式或 JSON 内容不正确/);
});

test("unsupported document versions fail before the Editor swaps runtimes or attaches a session", async () => {
  const dependencies = { buildEditorScenePayload: () => ({ schemaVersion: 99, objectList: [] }),
    compileAuthoring, sysConfig: {}, editorSettings: {},
    prepareFullEditorRuntime: () => assert.fail("must not create or swap a runtime"),
    authoringSession: { attach: () => assert.fail("must not replace the session") }
  };
  const init = new Function(...Object.keys(dependencies), `let sceneLoadGeneration = 0;
    ${extract("initSceneRuntime", "async function subInit(")} return initSceneRuntime;`)(...Object.values(dependencies));
  await assert.rejects(init(), (error) => error.code === "UNSUPPORTED_SCHEMA_VERSION");
});

test("declining archive runtime options never falls through to default options and imports anyway", async () => {
  for (const hasScene of [true, false]) {
    const dependencies = { suppressCanvasDirty: { runAsync: (fn) => fn() },
      inspectJsonSceneArchiveEntry: async () => ({ entryKind: "scene", payload: { objectList: [] } }),
      hasRuntimeReady: () => hasScene, scenePayloadFormat: null, editorSettings: {}, modalUi: {},
      resolveEditorRuntimeFlags: async () => null,
      resolveEditorRuntimeFlagsSync: () => assert.fail("cancel must not fall back to defaults"),
      ui: { setLoading() {}, showMessage: () => assert.fail("must not report success or an error"), runWithLoadingMask: () => assert.fail("must not load") },
      openOrCloseProgressManager() {}, formatEditorSceneImportError, console: { error: (e) => { throw e; } }
    };
    const handle = new Function(...Object.keys(dependencies), `${extract("handleLocalTjzArchiveFile", "async function handleTopBarOpenFile(")} return handleLocalTjzArchiveFile;`)(...Object.values(dependencies));
    await handle({ name: "scene.tjz", arrayBuffer: async () => new ArrayBuffer(0) }, { skipDirtyConfirm: true });
  }
});

test("custom confirm supports cancellation, re-opening, keyboard buttons and no stale handlers", async (t) => {
  const before = { document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame };
  const doc = new EventTarget(), elements = new Map();
  class Element extends EventTarget {
    classList = { add() {}, remove() {} };
    focus() { doc.activeElement = this; }
  }
  for (const id of ["editorConfirmModal", "editorConfirmModalTitle", "editorConfirmModalMessage", "editorConfirmModalCancelBtn", "editorConfirmModalConfirmBtn"]) elements.set(id, new Element());
  doc.getElementById = (id) => elements.get(id);
  doc.activeElement = new Element();
  globalThis.document = doc; globalThis.requestAnimationFrame = (fn) => fn();
  t.after(() => Object.assign(globalThis, before));
  const modal = createEditorConfirmModal(), cancel = elements.get("editorConfirmModalCancelBtn"), confirm = elements.get("editorConfirmModalConfirmBtn");
  const click = (element) => element.dispatchEvent(new Event("click", { cancelable: true }));
  let promise = modal.openConfirmModalAndWait("first");
  const escape = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
  doc.dispatchEvent(escape);
  assert.equal(await promise, false);
  promise = modal.openConfirmModalAndWait("second");
  assert.equal(elements.get("editorConfirmModalMessage").textContent, "second");
  click(confirm);
  assert.equal(await promise, true);
  const pending = modal.openConfirmModalAndWait("third");
  promise = modal.openConfirmModalAndWait("fourth");
  assert.equal(await pending, false);
  click(cancel);
  assert.equal(await promise, false);
  promise = modal.openConfirmModalAndWait("fifth");
  click(confirm);
  assert.equal(await promise, true);
});

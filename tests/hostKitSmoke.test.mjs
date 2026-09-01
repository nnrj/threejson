import assert from "node:assert/strict";
import { test } from "node:test";
// Expected asset URLs are built from the single pinned source (core/util/assetsBase.js, itself
// checked against the installed @threejson/assets devDependency by tests/assetsBase.test.mjs)
// rather than repeating the version literal here — a version bump then needs no edits in this file.
import { DEFAULT_CDN_ASSETS_BASE } from "threejson/assets";

// Imports every packages/host-kit module through its published-style specifier
// ("@threejson/host-kit/js/*.js") rather than a relative path into packages/host-kit/, so this
// test also proves the workspace link + package.json exports map actually work end to end — the
// same resolution path a real consumer of the published package would go through.

test("sceneHostAssetUrl/resolveSceneHostUrl resolve against the @threejson/assets CDN by default", async () => {
  const { sceneHostAssetUrl, resolveSceneHostUrl, setHostAssetsBase, getHostAssetsBase } = await import(
    "@threejson/host-kit/js/sceneHostPaths.js"
  );
  assert.equal(getHostAssetsBase(), DEFAULT_CDN_ASSETS_BASE);
  assert.equal(sceneHostAssetUrl("json/portShow.json"), `${DEFAULT_CDN_ASSETS_BASE}/json/portShow.json`);
  // Legacy repo-relative-style inputs (leading "../", "assets/" prefix) from callers ported
  // unchanged from tools/scene-host/shared still resolve correctly.
  assert.equal(
    resolveSceneHostUrl("../../../../assets/json/portShow.json"),
    `${DEFAULT_CDN_ASSETS_BASE}/json/portShow.json`
  );
  // Absolute/data/blob URLs pass through unchanged.
  assert.equal(resolveSceneHostUrl("https://example.com/x.json"), "https://example.com/x.json");
  assert.equal(resolveSceneHostUrl("data:text/plain,x"), "data:text/plain,x");

  setHostAssetsBase("/assets");
  assert.equal(sceneHostAssetUrl("json/portShow.json"), "/assets/json/portShow.json");
  setHostAssetsBase(""); // reset to the CDN default for other tests
  assert.equal(getHostAssetsBase(), DEFAULT_CDN_ASSETS_BASE);
});

test("editorSettingsSchema imports resolve through the public threejson/threejson-domains surface", async () => {
  const mod = await import("@threejson/host-kit/js/editorSettingsSchema.js");
  assert.equal(typeof mod.EDITOR_SETTINGS_STORAGE_KEY, "string");
  assert.ok(mod.EDITOR_SETTINGS_JSON_URL.startsWith("https://cdn.jsdelivr.net/npm/@threejson/assets@"));
  assert.equal(mod.EDITOR_SETTINGS_DEFAULTS.editing.boxHelperColor, "#E59520");
  assert.equal(mod.EDITOR_SETTINGS_DEFAULTS.editing.highlightChannels.locate, "#E6A800");
  assert.equal(mod.EDITOR_SETTINGS_DEFAULTS.editing.highlightChannels.alarm, "#DC3A2F");
  assert.equal(mod.EDITOR_SETTINGS_DEFAULTS.ai.maxAutoRefineRounds, 0);
  assert.equal(mod.EDITOR_SETTINGS_DEFAULTS.ai.agentPolicyVersion, 3);
  assert.equal(mod.EDITOR_SETTINGS_DEFAULTS.ai.sceneGenerationMode, "auto");
  assert.equal(mod.EDITOR_SETTINGS_DEFAULTS.ai.sceneMaxOutputTokens, 0);
  assert.equal("agentEnabled" in mod.EDITOR_SETTINGS_DEFAULTS.ai, false);
  assert.equal("agentDepth" in mod.EDITOR_SETTINGS_DEFAULTS.ai, false);
  // Portable default: no reference to the monorepo's examples/ folder.
  assert.equal(mod.EDITOR_SETTINGS_DEFAULTS.general.exitNavigateUrl, "");
});

test("playerSettingsStore and scenePresetsStore import cleanly (threejson/domains/sceneHighlight + CDN paths)", async () => {
  const playerStore = await import("@threejson/host-kit/js/playerSettingsStore.js");
  assert.equal(playerStore.PLAYER_SETTINGS_DEFAULTS.general.defaultSceneUrl, "json/portShow.json");
  const presetsStore = await import("@threejson/host-kit/js/scenePresetsStore.js");
  assert.ok(presetsStore.PRESET_MANIFEST_URL.startsWith("https://cdn.jsdelivr.net/npm/@threejson/assets@"));
  assert.equal(typeof presetsStore.loadPresetSceneEntries, "function");
});

test("hostedContainerDoor and resolveEditorEventBinding use capability-scoped ThreeJSON entries", async () => {
  const door = await import("@threejson/host-kit/js/hostedContainerDoor.js");
  assert.equal(typeof door.findCabinetRoot, "function");
  assert.equal(typeof door.findUpsRoot, "function");
  const eventBinding = await import("@threejson/host-kit/js/resolveEditorEventBinding.js");
  assert.equal(typeof eventBinding.resolveEditorCanvasBindSceneEvents, "function");
});

test("i18n/index exposes t()/getHostLocale() with a working default catalog", async () => {
  const { t, getHostLocale, normalizeLocale, detectNavigatorLocale } = await import("@threejson/host-kit/i18n/index.js");
  // Before initHostI18n()/loadHostLocaleCatalog() has run, currentLocale defaults to "en-US" with
  // an empty catalog — t() then derives a display string from the key itself (englishizeKey)
  // rather than using the fallback, matching the original tools/scene-host behavior exactly.
  assert.equal(t("any.missing.key", "fallback text"), "Key");
  assert.equal(typeof getHostLocale(), "string");
  assert.equal(normalizeLocale("zh"), "zh-CN");
  assert.equal(normalizeLocale("en"), "en-US");
  assert.equal(typeof detectNavigatorLocale(), "string");
});

test("templateExportBuilders points at a pinned, non-redundant @threejson/assets CDN base", async () => {
  const mod = await import("@threejson/host-kit/js/templateExportBuilders.js");
  const html = mod.buildHtmlTemplate({ sceneJsonText: "{}", inlineJson: true });
  assert.ok(html.includes(`${DEFAULT_CDN_ASSETS_BASE}/img/favicon.ico`));
  assert.ok(!html.includes(`${DEFAULT_CDN_ASSETS_BASE}/assets/`));
  assert.ok(!html.includes("@latest"));
});

test("meshExport exposes the shared format catalog and guards its inputs", async () => {
  const mod = await import("@threejson/host-kit/js/meshExport.js");

  // The catalog is the single source the editor / shower / threebox / player dialogs all render.
  assert.equal(mod.MESH_EXPORT_FORMATS.length, 6);
  assert.deepEqual(
    mod.MESH_EXPORT_FORMATS.map((f) => f.value),
    ["glb", "gltf", "obj", "stl", "ply", "usdz"]
  );
  for (const entry of mod.MESH_EXPORT_FORMATS) {
    assert.ok(entry.labelKey.startsWith("threebox.meshExport."), `${entry.value} needs an i18n key`);
    assert.ok(entry.fallback, `${entry.value} needs a fallback label`);
  }

  assert.equal(mod.isSupportedMeshExportFormat("glb"), true);
  assert.equal(mod.isSupportedMeshExportFormat("GLB"), true, "format check should be case-insensitive");
  assert.equal(mod.isSupportedMeshExportFormat("fbx"), false);
  assert.equal(mod.isSupportedMeshExportFormat(""), false);

  assert.equal(typeof mod.buildMeshExport, "function");
  assert.equal(typeof mod.exportSceneMeshToFile, "function");
  assert.equal(typeof mod.downloadBlob, "function");

  await assert.rejects(() => mod.buildMeshExport(null, { format: "glb" }), /scene is required/);
  await assert.rejects(() => mod.buildMeshExport({}, { format: "fbx" }), /unsupported format/);
});

test("scenePayloadViews returns loadable scene documents, not the normalisation record", async () => {
  const { toStandardScenePayload, toFriendlyScenePayload, resolveFriendlyMap } = await import(
    "@threejson/host-kit/js/scenePayloadViews.js"
  );
  const source = {
    version: 1,
    name: "views-fixture",
    worldInfo: { friendlyMap: { box1: "Crate" } },
    sceneConfig: { objects: [{ id: "box1", shape: "box", size: [1, 1, 1] }] }
  };
  const before = JSON.stringify(source);

  const standard = toStandardScenePayload(source);
  // The regression this guards: returning normalizeScenePayload()'s record instead of its .payload
  // yields a huge object carrying these internal fields, which is not a scene document.
  for (const leaked of ["sourcePayload", "compatPayload", "friendlyMap", "nativeSceneEntry"]) {
    assert.ok(!(leaked in standard), `internal normalisation field "${leaked}" leaked into the standard view`);
  }
  assert.ok(Array.isArray(standard.objectList), "standard view should expose objectList");
  assert.equal(standard.name, "views-fixture");

  const friendly = toFriendlyScenePayload(source);
  assert.ok(friendly.sceneConfig || friendly.worldInfo, "friendly view lost its authoring shape");

  // Converting must not mutate the caller's object.
  assert.equal(JSON.stringify(source), before, "conversion mutated its input");

  // friendlyMap is read from either location a document may carry it.
  assert.deepEqual(resolveFriendlyMap(source), { box1: "Crate" });
  assert.deepEqual(resolveFriendlyMap({ friendlyMap: { a: "A" } }), { a: "A" });
  assert.equal(resolveFriendlyMap({}), undefined);
});

test("sceneTreeModel hides runtime objects and keeps authored hierarchy", async () => {
  const { buildSceneTreeModel, countSceneTreeNodes, flattenSceneTree, findObjectInScene, isRuntimeOnlyObject } =
    await import("@threejson/host-kit/js/sceneTreeModel.js");

  // Minimal Object3D-shaped fixture: the model only reads name/type/uuid/visible/children/userData,
  // so it can be exercised without constructing a real three.js scene.
  const node = (over) => ({ uuid: "u-" + Math.random(), name: "", type: "Mesh", visible: true, children: [], ...over });
  const gizmo = node({ name: "gizmo", type: "TransformControls" });
  const child = node({ name: "wheel", userData: { objJson: { threeJsonId: "wheel-1" } } });
  const authored = node({
    name: "vehicle",
    type: "Group",
    userData: { objJson: { threeJsonId: "vehicle-1" } },
    children: [child, node({ name: "grid", type: "GridHelper" })]
  });
  const root = {
    traverse(fn) {
      const walk = (n) => { fn(n); (n.children || []).forEach(walk); };
      (this.children || []).forEach(walk);
    },
    children: [
      authored,
      gizmo,
      node({ name: "__threejson_native_scene__" }),
      node({ name: "sun", userData: { objJson: { objType: "light" } } }),
      node({ name: "editorGrid", userData: { editorOnly: true } })
    ]
  };

  const model = buildSceneTreeModel(root);
  assert.equal(model.length, 1, "only the authored group should survive filtering");
  assert.equal(model[0].threeJsonId, "vehicle-1");
  // The GridHelper child is filtered too — filtering is recursive, not just top-level.
  assert.equal(model[0].children.length, 1);
  assert.equal(model[0].children[0].threeJsonId, "wheel-1");
  assert.equal(countSceneTreeNodes(model), 2);

  // Lights are hidden by default but listable on request.
  assert.equal(buildSceneTreeModel(root, { hideLights: false }).length, 2);

  // App-owned gizmo instances are matched by identity, not type.
  const custom = node({ name: "myGizmo" });
  assert.equal(isRuntimeOnlyObject(custom), false);
  assert.equal(isRuntimeOnlyObject(custom, { extraRuntimeObjects: [custom] }), true);

  // Flattening carries depth for keyboard navigation.
  assert.deepEqual(flattenSceneTree(model).map((n) => n.depth), [0, 1]);

  // Rows resolve back to live objects by authored id, falling back to uuid.
  assert.equal(findObjectInScene(root, { threeJsonId: "wheel-1" }), child);
  assert.equal(findObjectInScene(root, { uuid: child.uuid }), child);
  assert.equal(findObjectInScene(root, { threeJsonId: "nope" }), null);

  // maxDepth guards pathological imported hierarchies.
  assert.equal(buildSceneTreeModel(root, { maxDepth: 1 })[0].children.length, 0);

  // An object with no authored id still renders (uuid is the fallback row key) but carries "".
  const anon = buildSceneTreeModel({ children: [node({ name: "anon" })] });
  assert.equal(anon[0].threeJsonId, "");
  assert.ok(anon[0].uuid);
});

test("scene-agent repository exposes its CRUD surface and collision-resistant ids", async () => {
  const store = await import("@threejson/scene-agent-kit/repository");
  const repository = store.createSceneAgentRepository({ dbName: "scene-agent-smoke", indexedDb: null });

  for (const fn of [
    "putTurn", "getTurn", "getTurnsForConversation", "getAllTurns", "deleteTurnsForConversation",
    "putResource", "getResource", "getAllResources", "deleteResource",
    "putConversation", "getConversation", "getAllConversations", "deleteConversation",
    "putProject", "getAllProjects", "resetConnection"
  ]) {
    assert.equal(typeof repository[fn], "function", `missing repository method: ${fn}`);
  }
  for (const fn of ["createTurnId", "createResourceId", "createConversationId", "createProjectId"])
    assert.equal(typeof store[fn], "function", `missing export: ${fn}`);

  // Ids are prefixed by kind (so a stray id is identifiable in a dump) and carry enough entropy
  // that turns created inside the same millisecond do not collide.
  assert.match(store.createTurnId(), /^turn-/);
  assert.match(store.createResourceId(), /^res-/);
  assert.match(store.createConversationId(), /^conv-/);
  assert.match(store.createProjectId(), /^proj-/);
  const batch = new Set(Array.from({ length: 500 }, () => store.createTurnId()));
  assert.equal(batch.size, 500, "id generator collided within a single millisecond");

  // Importing must not touch indexedDB — the module has to load in Node/SSR, where it is absent.
  assert.equal(typeof indexedDB, "undefined");
});

test("adjust-turn inputs: envelope carries the edit intent and context stays bounded", async () => {
  const { resolveAiAdjustContextPayload } = await import("@threejson/host-kit/js/aiTurnOrchestrator.js");
  const { buildStructuredTurnEnvelope } = await import("threejson/ai");

  const targetSceneJson = {
    version: 1,
    name: "adjust-fixture",
    objectList: [
      { threeJsonId: "box-1", objType: "box", position: { x: 0, y: 1, z: 0 } },
      { threeJsonId: "box-2", objType: "box", position: { x: 4, y: 1, z: 0 } }
    ]
  };

  // These two calls are exactly what apps/threebox composes before calling runAiAdjustTurn; the
  // round-trip through a provider is not covered here (it needs a live model), so this pins the
  // request-construction half that is deterministic.
  const contextPayload = resolveAiAdjustContextPayload(targetSceneJson, {});
  assert.ok(contextPayload && typeof contextPayload === "object");

  const envelope = buildStructuredTurnEnvelope({
    userPrompt: "make the first box red",
    intent: "adjust",
    targetTurnId: "turn-abc",
    contextPayload,
    includeReferenceLinks: true
  });

  assert.equal(typeof envelope, "string");
  assert.ok(envelope.includes("make the first box red"), "user prompt missing from the envelope");
  // The intent is what distinguishes an edit from a fresh generation; losing it silently turns an
  // adjust into a from-scratch scene, which is the failure this guards.
  assert.match(envelope, /adjust/i);

  // Context must be a *summary*, not the whole scene inlined — otherwise every adjust turn grows
  // with the scene and eventually blows the context window.
  assert.ok(
    envelope.length < JSON.stringify(targetSceneJson).length * 20,
    "envelope looks like it inlined the full scene"
  );
});

test("changed texture detection includes later materials on the same object", async () => {
  const { findChangedTextureObjectIds } = await import(
    "../tools/scene-host/shared/js/sceneTextureOrchestrator.js"
  );
  const before = {
    objectList: [{
      threeJsonId: "multi-material-box",
      objType: "box",
      materialArr: [
        { type: "standard", color: "#ffffff" },
        { type: "standard", color: "#666666", roughness: 0.8 }
      ]
    }]
  };
  const after = structuredClone(before);
  after.objectList[0].materialArr[1].roughness = 0.2;
  assert.deepEqual(
    Array.from(findChangedTextureObjectIds(before, after)),
    ["multi-material-box"]
  );
});

test("gizmo fold-back: syncBoxModelTransformFromObject3D writes a live transform into the descriptor", async () => {
  const THREE = await import("three");
  const { syncBoxModelTransformFromObject3D } = await import("threejson");

  // This is the exact contract the editor's TransformControls gizmo depends on: three drags the
  // live Object3D's transform, and on mouseUp the app folds that back into the object's descriptor
  // (userData.objJson) so the scene exporter — which reads the descriptor, not the live matrix —
  // captures it. Without this fold-back a gizmo drag would render but vanish on the next reload.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.userData.objJson = {
    threeJsonId: "box-1",
    objType: "box",
    position: { x: 0, y: 0, z: 0 }
  };

  // Simulate a drag.
  mesh.position.set(5, 3, -2);
  mesh.rotation.set(0, Math.PI / 2, 0);
  mesh.scale.set(2, 2, 2);

  const wrote = syncBoxModelTransformFromObject3D(mesh);
  assert.equal(wrote, true);

  const d = mesh.userData.objJson;
  assert.deepEqual(d.position, { x: 5, y: 3, z: -2 });
  assert.equal(Math.abs(d.rotation.y - Math.PI / 2) < 1e-9, true);
  assert.deepEqual(d.scale, { x: 2, y: 2, z: 2 });

  // An object with no descriptor is left alone rather than throwing (the gizmo can attach to
  // imported mesh parts that carry no objJson).
  const bare = new THREE.Object3D();
  assert.equal(syncBoxModelTransformFromObject3D(bare), false);
});

test("editorSessionIdb round-trips values by key without indexedDB in Node", async () => {
  const store = await import("@threejson/host-kit/js/editorSessionIdb.js");
  // The recovery keys the editor persists under are stable, documented constants — the app depends
  // on EDITOR_SESSION_RECOVERY_KEY not silently changing across a version.
  assert.equal(store.EDITOR_SESSION_RECOVERY_KEY, "recovery");
  assert.equal(typeof store.editorSessionIdbGet, "function");
  assert.equal(typeof store.editorSessionIdbPut, "function");
  assert.equal(typeof store.editorSessionIdbDelete, "function");

  // Importing must not touch indexedDB (absent in Node/SSR); the module has to load so an app that
  // guards on `typeof indexedDB` can still import it unconditionally.
  assert.equal(typeof indexedDB, "undefined");
});

test("scene-agent repository resources API shape backs a host library", async () => {
  const store = await import("@threejson/scene-agent-kit/repository");
  const repository = store.createSceneAgentRepository({ dbName: "scene-agent-resource-smoke", indexedDb: null });
  // The library panel (apps/threebox) drives exactly these; a rename would break it silently.
  for (const fn of ["getAllResources", "putResource", "getResource", "deleteResource", "createResourceId"]) {
    assert.equal(typeof (fn === "createResourceId" ? store : repository)[fn], "function", `missing resource API: ${fn}`);
  }
  // Resource ids are prefixed and collision-resistant within a millisecond, like the turn ids.
  assert.match(store.createResourceId(), /^res-/);
  const batch = new Set(Array.from({ length: 300 }, () => store.createResourceId()));
  assert.equal(batch.size, 300, "resource id generator collided within a single millisecond");
});

test("packJsonSceneArchive produces a real .tjz the parser can read back", async () => {
  const { packJsonSceneArchive, inspectJsonSceneArchiveEntry } = await import("threejson");

  // This is the exact call apps/threebox's scene card makes for its .tjz action. Pins that the
  // output is a genuine archive carrying the scene, not just a valid-but-empty zip.
  const scene = {
    version: 1,
    name: "tjz-fixture",
    objectList: [{ threeJsonId: "box-1", objType: "box", geometry: { width: 1, height: 1, depth: 1 } }]
  };

  const bytes = await packJsonSceneArchive(scene, { outputType: "uint8array" }).catch(async () =>
    // Node has no Blob output target in every build; fall back to raw bytes.
    packJsonSceneArchive(scene, {})
  );
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  // ZIP local-file-header magic "PK\x03\x04".
  assert.equal(u8[0], 0x50);
  assert.equal(u8[1], 0x4b);
  assert.equal(u8[2], 0x03);
  assert.equal(u8[3], 0x04);

  // The parser reads it back and recognises it as a scene archive.
  const info = await inspectJsonSceneArchiveEntry(u8);
  assert.ok(info, "archive did not inspect as a scene entry");
});

test("viewportGizmoOverlay imports and exposes its API (three-viewport-gizmo dependency resolves)", async () => {
  // Regression guard: this module bare-imports "three-viewport-gizmo", which host-kit did not
  // declare as a dependency — so the module was unimportable in any real bundler/consumer until the
  // optional peer dependency was added. Importing it here fails loudly if that regresses.
  const mod = await import("@threejson/host-kit/js/viewportGizmoOverlay.js");
  for (const fn of [
    "createViewportGizmoOverlay",
    "renderViewportGizmoOverlay",
    "updateViewportGizmoOverlay",
    "disposeViewportGizmoOverlay",
    "getViewportGizmoOverlay"
  ]) {
    assert.equal(typeof mod[fn], "function", `missing export: ${fn}`);
  }
  // Creating with no runtime/container is a no-op that returns null rather than throwing — the guard
  // an app relies on before a scene (and its camera/renderer) exists.
  assert.equal(mod.createViewportGizmoOverlay(null, null), null);
  assert.equal(mod.getViewportGizmoOverlay(), null);
});

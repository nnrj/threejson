import assert from "node:assert/strict";
import { test } from "node:test";

// Imports every packages/editor-kit entry through its published-style specifier
// ("@threejson/editor-kit/*"), proving the workspace links + exports map + the split routing of
// capability-scoped imports plus editor-only helpers via threejson/edit
// all resolve end to end. These modules are framework-agnostic no-DOM logic, so this covers module
// resolution and the public API shape rather than a live editor session.

test("editor command layer resolves and exposes the registry API", async () => {
  const mod = await import("@threejson/editor-kit/command");
  assert.equal(typeof mod.registerEditorCommands, "function");
  assert.equal(typeof mod.getEditorCommandHelp, "function");
  assert.ok(Array.isArray(mod.EDITOR_COMMAND_SPECS));
  assert.ok(mod.EDITOR_COMMAND_SPECS.length > 0, "expected at least one command spec");
});

test("editor command specs carry the current command API version", async () => {
  const specs = await import("@threejson/editor-kit/command/specs");
  assert.ok(Array.isArray(specs.EDITOR_COMMAND_SPECS));
  // wrapCoreCommandsForEditor + specs both import COMMAND_API_VERSION from threejson/core — if that
  // public re-export regressed, importing this module would have thrown above.
});

test("editor AI update flow resolves through capability entries + threejson/edit", async () => {
  const ai = await import("@threejson/editor-kit/ai");
  assert.equal(typeof ai.runEditorAiUpdate, "function");
  assert.equal(typeof ai.buildEditorUpdatePrompt, "function");
  assert.equal(typeof ai.collectEditorSceneContext, "function");
  assert.equal(typeof ai.resolveUpdateRoute, "function");
});

test("editor AI spatial-context shim re-exports the core spatial helpers", async () => {
  const spatial = await import("@threejson/editor-kit/ai/sceneSpatialContext");
  assert.equal(typeof spatial.buildObjectSpatialCardsFromScene, "function");
  assert.equal(typeof spatial.buildPlacementHints, "function");
  assert.equal(typeof spatial.buildSceneScaleProfile, "function");
  assert.equal(typeof spatial.pickReferenceObjects, "function");
});

test("domainEditSession resolves and exposes the domain-edit state machinery", async () => {
  const des = await import("@threejson/editor-kit/domainEditSession");
  // DOMAIN_EDIT_STATES comes from threejson/edit (the newly-exposed subpath) — its
  // presence here proves that subpath resolves through the package boundary.
  assert.equal(typeof des.DOMAIN_EDIT_STATES, "object");
  assert.equal(typeof des.resolveDomainDeployRoot, "function");
  assert.equal(typeof des.snapshotDomainChildTransforms, "function");
  assert.equal(typeof des.undoDomainChildEditFromPersistSource, "function");
});

test("threejson/edit exposes the editor-internal symbols editor-kit needs", async () => {
  const es = await import("threejson/edit");
  const expected = [
    "DOMAIN_EDIT_STATES", "collectDomainExportCaveats", "domainChildTransformsChanged",
    "getDomainEditState", "getPersistSource", "isDomainDeployRootObject",
    "resolveDomainDeployRootAncestor", "setDomainChildTransformBaseline", "setDomainEditState",
    "setPersistSource", "snapshotDomainChildTransforms", "attachAssemblyParentWarnings",
    "batchResultsHaveSceneMutation", "commandListHasMutatingOp", "formatObjectGetFeedbackFromBatch",
    "requestUpdatedSceneJsonString", "cloneJson", "exportWysiwygDeployRootFromObject3D",
    "getDomain", "isKnownDomainHandler", "setUserDataObjJson",
    "snapshotBoxModelTransformFromObject3D", "captureDomainPartOverrides",
    "assignDomainPartIds", "applyDomainPartDescriptorOverrides"
  ];
  for (const sym of expected) {
    assert.ok(sym in es, `threejson/edit is missing ${sym}`);
  }
  assert.equal(Object.keys(es).length, expected.length, "edit capability surface changed unexpectedly");
});

test("material.patch edits one field without disturbing the others", async () => {
  const THREE = await import("three");
  const { createCommandContext, executeCommand } = await import("threejson/commands");

  // The inspector's material panel dispatches material.patch with a single-field partial per edit,
  // precisely so changing colour cannot clobber roughness. This pins that the command merges the
  // partial into the existing material rather than replacing it — the property that makes each
  // material field its own independent, undoable edit. (command.test.mjs covers only the colour
  // round-trip, not sibling preservation.)
  const ctx = createCommandContext({ scene: new THREE.Scene() });
  const added = await executeCommand(ctx, {
    op: "object.add",
    args: {
      descriptor: {
        name: "mat-box",
        objType: "box",
        geometry: { width: 1, height: 1, depth: 1 },
        position: { x: 0, y: 0, z: 0 },
        // textureUrl is intentionally omitted: applying a texture needs a DOM image loader this
        // Node test has no access to. Sibling-preservation across a texture edit is covered in the
        // browser instead (see apps/scene-editor). These DOM-free fields prove the merge behaviour.
        material: { type: "standard", color: "#ffffff", roughness: 0.9, metalness: 0.2, opacity: 0.8, transparent: true }
      }
    }
  });
  assert.equal(added.ok, true);
  const id = added.data.threeJsonId;

  const patched = await executeCommand(ctx, {
    op: "material.patch",
    args: { id, partial: { color: "#cc3344" } }
  });
  assert.equal(patched.ok, true, `material.patch failed: ${patched.error}`);

  const material = (await executeCommand(ctx, { op: "object.get", args: { id, path: "material" } })).data.value;
  assert.equal(material.color, "#cc3344", "colour was not applied");
  // The whole point: sibling fields survive a single-field patch.
  assert.equal(material.roughness, 0.9, "roughness was clobbered by a colour-only patch");
  assert.equal(material.metalness, 0.2, "metalness was clobbered by a colour-only patch");
  assert.equal(material.opacity, 0.8, "opacity was clobbered by a colour-only patch");
  assert.equal(material.transparent, true, "transparent was clobbered by a colour-only patch");
});

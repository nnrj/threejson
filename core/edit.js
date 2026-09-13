/**
 * `threejson/edit` — edit-time helpers for authoring and mutating scenes on top of the ThreeJSON
 * engine: domain-edit state machinery, AI-command-batch inspection, and WYSIWYG export. These are
 * scene-editing capabilities that intentionally live OUTSIDE the main `threejson`/`threejson/core`
 * runtime API — a plain scene *consumer* (load a JSON, render it) never needs them, and exposing
 * them from core/index.js would bloat that surface with edit-time implementation detail.
 *
 * They are gathered on this one capability-scoped path so a scene-editing host (its primary consumer
 * is @threejson/editor-kit) can depend on a stable import path instead of reaching into deep core/
 * source files. Treat this as a narrower stability contract than the main engine API.
 */

// Domain-edit state machinery — tracks a domain deploy-root's edit lifecycle (pristine / shell-
// dirty / children-dirty / pending-resolution), child-transform baselines, and export-caveat
// collection, as an edit-time host mutates a deployed business-domain object.
export {
  DOMAIN_EDIT_STATES,
  collectDomainExportCaveats,
  domainChildTransformsChanged,
  getDomainEditState,
  getPersistSource,
  isDomainDeployRootObject,
  resolveDomainDeployRootAncestor,
  setDomainChildTransformBaseline,
  setDomainEditState,
  setPersistSource,
  snapshotDomainChildTransforms
} from "./handler/domainDeployDescriptor.js";

// AI command-batch inspection helpers — decide whether a returned command batch actually mutates
// the scene and format object-get feedback (used by AI-driven edit flows).
export {
  attachAssemblyParentWarnings,
  batchResultsHaveSceneMutation,
  commandListHasMutatingOp,
  formatObjectGetFeedbackFromBatch
} from "./ai/sceneCommandSkill.js";

// AI scene-JSON update round-trip (the non-command, whole-JSON regeneration path).
export { requestUpdatedSceneJsonString } from "./ai/sceneAiService.js";

// Edit-time utility helpers.
export { cloneJson } from "./util/cloneJson.js";
export { exportWysiwygDeployRootFromObject3D } from "./util/sceneToJson.js";
export { getDomain, isKnownDomainHandler } from "./handler/businessDomainRegistry.js";
export { setUserDataObjJson } from "./handler/objectDescriptorAttach.js";
export { snapshotBoxModelTransformFromObject3D } from "./builder/modelBuilder.js";
export { captureDomainPartOverrides } from "./runtime/domainPartState.js";
export { assignDomainPartIds, applyDomainPartDescriptorOverrides } from "./document/domainParts.js";

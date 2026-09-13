/**
 * Domain deploy root runtime descriptor and persistence fidelity.
 * Deploy root `userData.objJson` / `persistSource` keep the loaded record as-is (only fill default ids, sync transforms);
 * core does not normalize domain records into an items shell. Each domain defines its JSON shape.
 *
 * Runtime extras: `userData.persistSource` (original load record), `userData.domainEditState` (edit state machine).
 */
import * as THREE from "three";

import { cloneJson } from "../util/cloneJson.js";
import { resolvePosition, resolveRotation, resolveScale } from "../util/vectorValue.js";
import { snapshotBoxModelTransformFromObject3D } from "../builder/modelBuilder.js";
import { getDomain } from "./businessDomainRegistry.js";
import { setUserDataObjJson } from "./objectDescriptorAttach.js";
import { initializeDomainPartState, captureDomainPartOverrides } from "../runtime/domainPartState.js";

/** @typedef {"pristine"|"shellDirty"|"childrenDirty"|"pendingResolution"|"bound"|"degraded"} DomainEditState */

export const DOMAIN_EDIT_STATES = Object.freeze({
  PRISTINE: "pristine",
  SHELL_DIRTY: "shellDirty",
  CHILDREN_DIRTY: "childrenDirty",
  PENDING_RESOLUTION: "pendingResolution",
  BOUND: "bound",
  DEGRADED: "degraded"
});

const BLOCKING_EXPORT_STATES = new Set([
  DOMAIN_EDIT_STATES.CHILDREN_DIRTY,
  DOMAIN_EDIT_STATES.PENDING_RESOLUTION
]);

const PRISTINE_EXPORT_STATES = new Set([
  DOMAIN_EDIT_STATES.PRISTINE,
  DOMAIN_EDIT_STATES.SHELL_DIRTY,
  "",
  undefined,
  null
]);

/**
 * @param {object|null|undefined} objJson
 * @returns {boolean}
 */
export function isDomainDeployRootObjJson(objJson) {
  if (!objJson || typeof objJson !== "object" || Array.isArray(objJson)) {
    return false;
  }
  const objType = String(objJson.objType || "").trim().toLowerCase();
  const domain = String(objJson.domain || "").trim();
  return objType === "domain" && domain.length > 0;
}

/**
 * objType match for scene queries.
 * @param {object|null|undefined} objJson
 * @param {string} type
 * @returns {boolean}
 */
export function matchesObjTypeForSceneQuery(objJson, type) {
  if (!objJson || !type) {
    return false;
  }
  const want = String(type).trim();
  if (!want) {
    return false;
  }
  return String(objJson.objType || "").trim() === want || String(objJson.semanticType || "").trim() === want;
}

/**
 * Read the business item from a deploy root (items[0] only when the record is an items shell).
 * @param {object|null|undefined} objJson
 * @returns {object|null}
 */
export function resolveDomainItemDescriptor(objJson) {
  if (!objJson || typeof objJson !== "object" || Array.isArray(objJson)) {
    return null;
  }
  if (isDomainDeployRootObjJson(objJson)) {
    const items = objJson.items;
    if (Array.isArray(items) && items[0] && typeof items[0] === "object") {
      return items[0];
    }
    return objJson;
  }
  return objJson;
}

/**
 * Clone the load record and fill only default domain identifiers (no split/merge into items).
 * @param {object|null|undefined} loadRecord
 * @param {{ domainId?: string, handler?: string, extras?: object }} [options]
 * @returns {object|null}
 */
export function prepareDomainDeployPersistRecord(loadRecord, options = {}) {
  const { domainId, handler, extras = {} } = options;
  if (!loadRecord || typeof loadRecord !== "object" || Array.isArray(loadRecord)) {
    return null;
  }
  const out = cloneJson(loadRecord);
  if (domainId && !String(out.domain || "").trim()) {
    out.domain = domainId;
  }
  if (handler && !String(out.handler || "").trim()) {
    out.handler = handler;
  }
  if (isDomainDeployRootObjJson(out)) {
    out.objType = "domain";
  }
  const threeJsonId = String(extras.threeJsonId ?? out.threeJsonId ?? "").trim();
  if (threeJsonId) {
    out.threeJsonId = threeJsonId;
  }
  return out;
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @returns {DomainEditState|string}
 */
export function getDomainEditState(object) {
  const state = object?.userData?.domainEditState;
  return typeof state === "string" ? state.trim() : DOMAIN_EDIT_STATES.PRISTINE;
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @param {DomainEditState|string} state
 * @returns {import("three").Object3D|null|undefined}
 */
export function setDomainEditState(object, state) {
  if (!object) {
    return object;
  }
  const prev = object.userData && typeof object.userData === "object" ? object.userData : {};
  object.userData = { ...prev, domainEditState: String(state || DOMAIN_EDIT_STATES.PRISTINE) };
  return object;
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @returns {object|null}
 */
export function getPersistSource(object) {
  const src = object?.userData?.persistSource;
  if (!src || typeof src !== "object" || Array.isArray(src)) {
    return null;
  }
  return src;
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @param {object|null|undefined} record
 * @returns {import("three").Object3D|null|undefined}
 */
export function setPersistSource(object, record) {
  if (!object || record == null || typeof record !== "object" || Array.isArray(record)) {
    return object;
  }
  const prev = object.userData && typeof object.userData === "object" ? object.userData : {};
  object.userData = { ...prev, persistSource: cloneJson(record) };
  return object;
}

/**
 * Snapshot child transforms on drill-in entry; used by bound export to detect child drift from the original.
 * @param {import("three").Object3D} root
 * @returns {Record<string, object>}
 */
export function snapshotDomainChildTransforms(root, options = {}) {
  const out = {};
  if (!root?.traverse) {
    return out;
  }
  root.traverse((obj) => {
    if (obj === root || !(obj instanceof THREE.Object3D)) {
      return;
    }
    const id = obj.userData?.objJson?.domainPartId || obj.userData?.objJson?.threeJsonId || obj.uuid;
    const source = resolveDomainItemDescriptor(obj.userData?.objJson);
    const t = options.state === "authoring" && source ? authoredTransform(source) : snapshotBoxModelTransformFromObject3D(obj);
    if (id && t) {
      out[id] = cloneJson(options.includeDescriptor ? { ...t, descriptor: obj.userData?.objJson || null } : t);
    }
  });
  return out;
}

/**
 * @param {Record<string, object>|null|undefined} baseline
 * @param {Record<string, object>|null|undefined} current
 * @returns {boolean}
 */
export function domainChildTransformsChanged(baseline, current) {
  const keys = new Set([...Object.keys(baseline || {}), ...Object.keys(current || {})]);
  for (const key of keys) {
    if (JSON.stringify(baseline?.[key] ?? null) !== JSON.stringify(current?.[key] ?? null)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @returns {Record<string, object>|null}
 */
export function getDomainChildTransformBaseline(object) {
  const baseline = object?.userData?.domainChildTransformBaseline;
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) {
    return null;
  }
  return baseline;
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @param {Record<string, object>|null|undefined} baseline
 * @returns {import("three").Object3D|null|undefined}
 */
export function setDomainChildTransformBaseline(object, baseline) {
  if (!object) {
    return object;
  }
  const prev = object.userData && typeof object.userData === "object" ? object.userData : {};
  if (!baseline || typeof baseline !== "object") {
    const next = { ...prev };
    delete next.domainChildTransformBaseline;
    object.userData = next;
    return object;
  }
  object.userData = { ...prev, domainChildTransformBaseline: cloneJson(baseline) };
  return object;
}

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @returns {boolean}
 */
export function boundDomainHasChildTransformDrift(object3D) {
  const baseline = getDomainChildTransformBaseline(object3D);
  if (!baseline) {
    return false;
  }
  return domainChildTransformsChanged(baseline, snapshotDomainChildTransforms(object3D));
}

/**
 * After deploy, attach the original load record and edit state (does not rewrite JSON shape).
 * @param {import("three").Object3D|null|undefined} object
 * @param {object} options
 * @param {string} options.domainId
 * @param {string} [options.handler]
 * @param {object} [options.itemDescriptor]
 * @param {object} [options.loadRecord]
 * @param {object} [options.extras]
 * @returns {import("three").Object3D|null|undefined}
 */
export function finalizeDomainDeployRoot(object, options = {}) {
  const { domainId, handler, itemDescriptor, loadRecord, extras = {} } = options;
  if (!object || !domainId) {
    return object;
  }
  const source = prepareDomainDeployPersistRecord(loadRecord && typeof loadRecord === "object" ? loadRecord : itemDescriptor, {
    domainId,
    handler,
    extras
  });
  if (!source) {
    return object;
  }
  setUserDataObjJson(object, source);
  setPersistSource(object, source);
  setDomainEditState(object, DOMAIN_EDIT_STATES.PRISTINE);
  initializeDomainPartState(object, source, options);
  return object;
}

/**
 * @param {object|null|undefined} objJson
 * @returns {boolean}
 */
export function isPseudoDomainObjJson(objJson) {
  if (!objJson || typeof objJson !== "object" || Array.isArray(objJson)) {
    return false;
  }
  const objType = String(objJson.objType || "").trim().toLowerCase();
  if (objType !== "domain") {
    return false;
  }
  return !String(objJson.domain || "").trim();
}

/**
 * @param {object} record
 * @param {import("three").Object3D|null|undefined} object3D
 * @param {object|null|undefined} transform
 * @returns {object}
 */
function applyTransformOntoDomainRecord(record, object3D, transform) {
  const out = cloneJson(record);
  if (Array.isArray(out.items) && out.items[0] && typeof out.items[0] === "object") {
    if (transform) {
      out.items[0].position = transform.position;
      out.items[0].rotation = transform.rotation;
      out.items[0].scale = transform.scale;
    }
    if (typeof object3D?.visible === "boolean") {
      out.items[0].visible = object3D.visible;
    }
    return out;
  }
  if (transform) {
    out.position = transform.position;
    out.rotation = transform.rotation;
    out.scale = transform.scale;
  }
  if (typeof object3D?.visible === "boolean") {
    out.visible = object3D.visible;
  }
  return out;
}

/**
 * Sync deploy-root transforms onto persistSource (for pristine / shellDirty export).
 * @param {object} persistSource
 * @param {import("three").Object3D|null|undefined} object3D
 * @returns {object}
 */
export function syncTransformOntoPersistSource(persistSource, object3D) {
  const transform = snapshotBoxModelTransformFromObject3D(object3D);
  return applyTransformOntoDomainRecord(persistSource, object3D, transform);
}

/**
 * Export an objectList entry from a deploy root (prefer persistSource fidelity path).
 * @param {import("three").Object3D|null|undefined} object3D
 * @returns {object|null}
 */
function authoredTransform(source) {
  // Use the same position/rotation/scale aliases as ordinary descriptor deployment.
  const p = resolvePosition(source?.position), r = resolveRotation(source?.rotation), s = resolveScale(source?.scale);
  if (Array.isArray(source?.quaternion)) {
    const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(source.quaternion).normalize());
    r.x = euler.x; r.y = euler.y; r.z = euler.z;
  }
  return { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: r.x, y: r.y, z: r.z }, scale: { x: s.x, y: s.y, z: s.z } };
}

export function exportDeployRootDescriptor(object3D, options = {}) {
  if (!object3D) {
    return null;
  }
  const liveJson = object3D.userData?.objJson;
  const state = getDomainEditState(object3D);
  if (state === DOMAIN_EDIT_STATES.DEGRADED) {
    return null;
  }
  const persistSource = getPersistSource(object3D);
  const syncRoot = (source) => options.state === "authoring"
    ? applyTransformOntoDomainRecord(source, { visible: resolveDomainItemDescriptor(liveJson)?.visible }, authoredTransform(resolveDomainItemDescriptor(liveJson)))
    : syncTransformOntoPersistSource(source, object3D);
  if (persistSource && PRISTINE_EXPORT_STATES.has(state)) {
    return syncRoot(persistSource);
  }
  if ((state === DOMAIN_EDIT_STATES.BOUND || (options.state === "authoring" && BLOCKING_EXPORT_STATES.has(state))) && persistSource) {
    const overrides = captureDomainPartOverrides(object3D, {
      state: options.state,
      childBaseline: getDomainChildTransformBaseline(object3D),
      currentTransforms: snapshotDomainChildTransforms(object3D, options)
    });
    const result = syncRoot(persistSource);
    const target = result.items?.[0] || result.payload || result;
    if (overrides.parts.length) target.domainOverrides = overrides;
    else delete target.domainOverrides;
    return result;
  }
  if (liveJson && typeof liveJson === "object" && !Array.isArray(liveJson)) {
    return options.state === "authoring" ? cloneJson(liveJson) : syncDomainDeployItemFromObject3D(liveJson, object3D);
  }
  return null;
}

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @param {import("three").Scene|null|undefined} [scene]
 * @returns {import("three").Object3D|null}
 */
export function resolveDomainDeployRootAncestor(object3D, scene = null) {
  let cur = object3D;
  while (cur) {
    const liveJson = cur.userData?.objJson;
    if (isDomainDeployRootObjJson(liveJson) || getPersistSource(cur)) {
      return cur;
    }
    if (scene && cur.parent === scene) {
      break;
    }
    cur = cur.parent;
  }
  return null;
}

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @returns {boolean}
 */
export function isDomainDeployRootObject(object3D) {
  if (!object3D) {
    return false;
  }
  return isDomainDeployRootObjJson(object3D.userData?.objJson) || Boolean(getPersistSource(object3D));
}

/**
 * @param {import("three").Scene} scene
 * @param {object} [options]
 * @returns {{ ok: boolean, blocking: object[] }}
 */
/**
 * Unrepresentable bound changes are conflicts, never a successful save that loses edits.
 *
 * @param {import("three").Scene} scene
 * @param {object} [options]
 * @returns {{ object3D: import("three").Object3D, name: string, domainId: string, hasCapture: boolean }[]}
 */
export function collectDomainExportCaveats(scene, options = {}) {
  const shouldSkip = typeof options.shouldSkipObject === "function"
    ? options.shouldSkipObject
    : () => false;
  const caveats = [];
  const children = scene?.children;
  if (!children?.length) {
    return caveats;
  }
  for (let i = 0; i < children.length; i += 1) {
    const root = children[i];
    if (!root || shouldSkip(root)) {
      continue;
    }
    if (getDomainEditState(root) !== DOMAIN_EDIT_STATES.BOUND) {
      continue;
    }
    let conflict;
    try { exportDeployRootDescriptor(root); continue; }
    catch (error) { conflict = error; }
    const persistSource = getPersistSource(root);
    const domainId = String(persistSource?.domain || root.userData?.objJson?.domain || "").trim();
    const hasCapture = typeof getDomain(domainId)?.api?.capturePersistDescriptor === "function";
    const name = root.name || root.userData?.objJson?.name || root.uuid;
    caveats.push({ object3D: root, name, domainId, hasCapture, code: conflict.code, message: conflict.message });
  }
  return caveats;
}

export function assertSceneExportable(scene, options = {}) {
  const shouldSkip = typeof options.shouldSkipObject === "function"
    ? options.shouldSkipObject
    : () => false;
  const blocking = [];
  const children = scene?.children;
  if (!children?.length) {
    return { ok: true, blocking };
  }
  for (let i = 0; i < children.length; i += 1) {
    const root = children[i];
    if (!root || shouldSkip(root)) {
      continue;
    }
    const state = getDomainEditState(root);
    const name = root.name || root.userData?.objJson?.name || root.uuid;
    if (BLOCKING_EXPORT_STATES.has(state)) {
      blocking.push({ object3D: root, reason: "domain_edit_pending", state, name });
      continue;
    }
    if (state === DOMAIN_EDIT_STATES.BOUND) {
      try { exportDeployRootDescriptor(root); }
      catch (error) { blocking.push({ object3D: root, reason: error.code || "domain_part_conflict", message: error.message, state, name }); }
    }
    const liveJson = root.userData?.objJson;
    if (isPseudoDomainObjJson(liveJson)) {
      blocking.push({ object3D: root, reason: "pseudo_domain", state, name });
    }
  }
  return { ok: blocking.length === 0, blocking };
}

/**
 * @param {import("three").Scene} scene
 * @param {object} [options]
 */
export class SceneExportBlockedError extends Error {
  /**
   * @param {object[]} blocking
   */
  constructor(blocking) {
    const names = blocking.map((b) => b.name || "unnamed").join(", ");
    super(`Scene export blocked: unconfirmed domain edits or invalid domain records (${names})`);
    this.name = "SceneExportBlockedError";
    this.blocking = blocking;
  }
}

/**
 * @param {import("three").Scene} scene
 * @param {object} [options]
 */
export function assertSceneExportableOrThrow(scene, options = {}) {
  const result = assertSceneExportable(scene, options);
  if (!result.ok) {
    throw new SceneExportBlockedError(result.blocking);
  }
  return result;
}

/**
 * Sync deploy-root Object3D transforms onto the record (items or flat shape).
 * @param {object} domainRecord
 * @param {import("three").Object3D|null|undefined} object3D
 * @returns {object}
 */
export function syncDomainDeployItemFromObject3D(domainRecord, object3D) {
  const transform = snapshotBoxModelTransformFromObject3D(object3D);
  return applyTransformOntoDomainRecord(domainRecord, object3D, transform);
}

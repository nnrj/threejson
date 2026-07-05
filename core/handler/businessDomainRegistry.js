/**
 * Business domain registration and unified deploy: legacy mapping via resolveDomainModel; optional compose fallback to deployMesh.
 */
import { deployMesh } from "../builder/modelBuilder.js";
import { log } from "../util/logger.js";
import { deployNativeObjectRecord } from "../builder/nativeObjectBuilder.js";
import {
  getLeafDomainSegment,
  getParentQualifiedDomainId,
  isBareChildDomainLookup,
  isQualifiedDomainId,
  listQualifiedDomainIdPrefixes,
  normalizeQualifiedDomainId
} from "./domainId.js";
import { shouldTryNativeFallback } from "./nativeParseMode.js";
import {
  CORE_MESH_PRIMITIVE_OBJ_TYPES,
  isCoreMeshPrimitiveObjType,
  isDefaultModelEnabled
} from "./defaultModelDescriptor.js";
import { deployAsDefaultModel } from "./sceneDefaultModel.js";

const MESH_PRIMITIVE_OBJ_TYPES = CORE_MESH_PRIMITIVE_OBJ_TYPES;

function normalizeObjTypeLocal(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @typedef {Object} BusinessDomainDescriptor
 * @property {string} id
 * @property {(boxModel: object, ctx?: object) => import("three").Object3D | null | undefined} [composeBoxModel]
 * @property {Record<string, (...args: any[]) => any>} [api]
 * @property {string} [defaultHandler]
 * @property {(record: object, scene: import("three").Scene, ctx?: object) => void} [resolveDomainModel]
 * @property {Record<string, (record: object, scene: import("three").Scene, ctx?: object) => void>} [domainHandlers]
 * @property {string[] | Record<string, string>} [legacyBoxObjTypes]
 * @property {string[]} [peerDomains]
 */

/** @type {Map<string, BusinessDomainDescriptor>} */
const domainById = new Map();

/** @type {Set<string>} */
const navigationPrefixIds = new Set();

/** @type {Map<string, Set<string>>} */
const childIdsByParent = new Map();

let builtinsLoaded = false;

/** @type {BusinessDomainDescriptor[]} */
let pendingBuiltinDescriptors = [];

/**
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function isComposeBoxModelEnabled(ctx) {
  const root = ctx?.sceneJsonRoot ?? ctx?.jsonData;
  const sceneConfig = root?.sceneConfig;
  return Boolean(sceneConfig && sceneConfig.enableComposeBoxModel === true);
}

export { isDefaultModelEnabled };

function toPascalCase(value) {
  return String(value || "")
    .replace(/(^|[-_\s]+)([a-zA-Z0-9])/g, (_m, _sep, ch) => ch.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * @param {BusinessDomainDescriptor} descriptor
 * @returns {{ createKey: string, deployKey: string, capLeaf: string }}
 */
function getLeafApiKeys(descriptor) {
  const leaf = getLeafDomainSegment(descriptor.id);
  const capLeaf = toPascalCase(leaf);
  return {
    createKey: `create${capLeaf}`,
    deployKey: `deploy${capLeaf}`,
    capLeaf
  };
}

/**
 * @param {BusinessDomainDescriptor} descriptor
 * @returns {boolean}
 */
export function isDomainDeployable(descriptor) {
  if (!descriptor?.api || typeof descriptor.api !== "object") {
    return false;
  }
  const { createKey, deployKey } = getLeafApiKeys(descriptor);
  return (
    typeof descriptor.api[createKey] === "function" &&
    typeof descriptor.api[deployKey] === "function"
  );
}

/**
 * @param {BusinessDomainDescriptor} descriptor
 * @returns {boolean}
 */
export function isDomainDispatchable(descriptor) {
  if (!descriptor) {
    return false;
  }
  if (!isDomainDeployable(descriptor)) {
    return false;
  }
  const hasResolve = typeof descriptor.resolveDomainModel === "function";
  const hasHandlers =
    descriptor.domainHandlers && typeof descriptor.domainHandlers === "object";
  return hasResolve || hasHandlers;
}

/**
 * @param {string} parentId
 * @param {string} childId
 */
function linkParentChild(parentId, childId) {
  if (!parentId) {
    return;
  }
  let set = childIdsByParent.get(parentId);
  if (!set) {
    set = new Set();
    childIdsByParent.set(parentId, set);
  }
  set.add(childId);
  navigationPrefixIds.add(parentId);
}

/**
 * @param {BusinessDomainDescriptor} descriptor
 */
function indexDomainNavigation(descriptor) {
  const id = descriptor.id;
  for (const prefix of listQualifiedDomainIdPrefixes(id)) {
    navigationPrefixIds.add(prefix);
    linkParentChild(prefix, id);
  }
  const parentId = getParentQualifiedDomainId(id);
  if (parentId) {
    linkParentChild(parentId, id);
  }
}

function rebuildNavigationIndex() {
  navigationPrefixIds.clear();
  childIdsByParent.clear();
  for (const descriptor of domainById.values()) {
    indexDomainNavigation(descriptor);
  }
}

/**
 * @param {BusinessDomainDescriptor[]} descriptors
 * @returns {BusinessDomainDescriptor[]}
 */
function sortDescriptorsForRegistration(descriptors) {
  const list = Array.isArray(descriptors) ? [...descriptors] : [];
  const byId = new Map(list.map((d) => [d.id, d]));
  /** @type {BusinessDomainDescriptor[]} */
  const sorted = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(id) {
    if (!id || visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new Error(`[domain] cyclic peerDomains or parent dependency: ${id}`);
    }
    visiting.add(id);
    const descriptor = byId.get(id);
    if (descriptor) {
      const parentId = getParentQualifiedDomainId(descriptor.id);
      if (parentId && byId.has(parentId)) {
        visit(parentId);
      }
      const peers = Array.isArray(descriptor.peerDomains) ? descriptor.peerDomains : [];
      for (let i = 0; i < peers.length; i += 1) {
        const peer = String(peers[i] || "").trim();
        if (peer && byId.has(peer)) {
          visit(peer);
        }
      }
      sorted.push(descriptor);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const descriptor of list) {
    visit(descriptor.id);
  }
  return sorted;
}

/**
 * @param {string} prefix
 * @returns {boolean}
 */
function hasRegisteredDescendant(prefix) {
  if (!prefix) {
    return false;
  }
  const direct = childIdsByParent.get(prefix);
  if (direct && direct.size > 0) {
    return true;
  }
  const needle = `${prefix}.`;
  for (const id of domainById.keys()) {
    if (id.startsWith(needle)) {
      return true;
    }
  }
  return false;
}

export function validateDomainDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") {
    throw new Error("[domain] descriptor must be an object");
  }
  if (!descriptor.id || typeof descriptor.id !== "string") {
    throw new Error("[domain] descriptor.id is required");
  }
  if (!isQualifiedDomainId(descriptor.id)) {
    throw new Error(
      `[domain:${descriptor.id}] id must be dot-separated segments matching [a-z][a-z0-9]*`
    );
  }
  if (!descriptor.api || typeof descriptor.api !== "object") {
    throw new Error(`[domain:${descriptor.id}] api must be an object`);
  }

  const deployable = isDomainDeployable(descriptor);
  const { createKey, deployKey, capLeaf } = getLeafApiKeys(descriptor);

  if (deployable) {
    if (typeof descriptor.api[createKey] !== "function") {
      throw new Error(`[domain:${descriptor.id}] missing required api.${createKey}()`);
    }
    if (typeof descriptor.api[deployKey] !== "function") {
      throw new Error(`[domain:${descriptor.id}] missing required api.${deployKey}()`);
    }
    const createJsonKey = `create${capLeaf}Json`;
    if (typeof descriptor.api[createJsonKey] !== "function") {
      log.warn(`[domain:${descriptor.id}] recommended api.${createJsonKey}() is missing`);
    }
    const hasResolve = typeof descriptor.resolveDomainModel === "function";
    const hasHandlers =
      descriptor.domainHandlers && typeof descriptor.domainHandlers === "object";
    if (!hasResolve && !hasHandlers) {
      log.warn(`[domain:${descriptor.id}] lacks resolveDomainModel and domainHandlers`);
    }
  } else {
    log.warn(
      `[domain:${descriptor.id}] namespace-only descriptor (no api.${createKey} / api.${deployKey}); invokeDomainModel on this id will warn`
    );
  }
}

/**
 * @param {BusinessDomainDescriptor} descriptor
 * @param {Set<string>} registeringIds
 */
function assertPeerDomainsAvailable(descriptor, registeringIds) {
  const peers = Array.isArray(descriptor.peerDomains) ? descriptor.peerDomains : [];
  for (let i = 0; i < peers.length; i += 1) {
    const peer = String(peers[i] || "").trim();
    if (!peer) {
      continue;
    }
    if (!domainById.has(peer) && !registeringIds.has(peer)) {
      throw new Error(
        `[domain:${descriptor.id}] peerDomains requires registered parent domain "${peer}"`
      );
    }
  }
  const parentId = getParentQualifiedDomainId(descriptor.id);
  if (parentId && !domainById.has(parentId) && !registeringIds.has(parentId)) {
    const peersIncludeParent = peers.includes(parentId);
    if (!peersIncludeParent) {
      log.warn(
        `[domain:${descriptor.id}] parent id "${parentId}" is not registered; sub-domain may still load if parent is builtin`
      );
    }
  }
}

function registerDomainInternal(descriptor) {
  validateDomainDescriptor(descriptor);
  const id = normalizeQualifiedDomainId(descriptor.id);
  domainById.set(id, descriptor);
  indexDomainNavigation(descriptor);
}

export function registerDomain(descriptor) {
  assertPeerDomainsAvailable(descriptor, new Set([descriptor.id]));
  registerDomainInternal(descriptor);
}

/**
 * Inject built-in or user domain manifests (called from `builtins/register.js` or app entry).
 * @param {BusinessDomainDescriptor[]} [descriptors]
 */
export function initBusinessDomains(descriptors) {
  if (descriptors !== undefined) {
    pendingBuiltinDescriptors = Array.isArray(descriptors) ? descriptors : [];
    builtinsLoaded = false;
    domainById.clear();
    navigationPrefixIds.clear();
    childIdsByParent.clear();
  }
  if (builtinsLoaded) {
    return;
  }
  const sorted = sortDescriptorsForRegistration(pendingBuiltinDescriptors);
  const batchIds = new Set(sorted.map((d) => d.id));
  for (const descriptor of sorted) {
    assertPeerDomainsAvailable(descriptor, batchIds);
    registerDomainInternal(descriptor);
  }
  rebuildNavigationIndex();
  builtinsLoaded = true;
}

/**
 * @returns {BusinessDomainDescriptor[]}
 */
function listRegisteredDomains() {
  initBusinessDomains();
  return [...domainById.values()];
}

/**
 * @param {string} segment
 * @returns {boolean}
 */
function isAmbiguousBareSegmentLookup(segment) {
  if (!segment || segment.includes(".")) {
    return false;
  }
  if (domainById.has(segment)) {
    return false;
  }
  const suffix = `.${segment}`;
  for (const qualifiedId of domainById.keys()) {
    if (qualifiedId.endsWith(suffix)) {
      return true;
    }
  }
  return false;
}

export function getDomain(id) {
  initBusinessDomains();
  const normalized = typeof id === "string" ? id.trim() : "";
  if (!normalized) {
    return null;
  }
  if (domainById.has(normalized)) {
    return domainById.get(normalized) ?? null;
  }
  if (isBareChildDomainLookup(normalized) && isAmbiguousBareSegmentLookup(normalized)) {
    return null;
  }
  return domainById.get(normalized) ?? null;
}

/**
 * @param {string} prefix
 * @returns {boolean}
 */
export function hasDomainNavigationPrefix(prefix) {
  initBusinessDomains();
  return navigationPrefixIds.has(prefix) || domainById.has(prefix);
}

/**
 * On bind / load, verify the handler is among the domain's declared dispatch entry points.
 * @param {BusinessDomainDescriptor|null|undefined} domain
 * @param {string|null|undefined} handler
 * @returns {boolean}
 */
export function isKnownDomainHandler(domain, handler) {
  const h = String(handler || "").trim();
  if (!domain || !h) {
    return false;
  }
  if (domain.domainHandlers && typeof domain.domainHandlers[h] === "function") {
    return true;
  }
  if (h === domain.defaultHandler) {
    return true;
  }
  const legacy = domain.legacyBoxObjTypes;
  if (Array.isArray(legacy) && legacy.includes(h)) {
    return true;
  }
  if (legacy && typeof legacy === "object") {
    if (Object.prototype.hasOwnProperty.call(legacy, h)) {
      return true;
    }
    for (const value of Object.values(legacy)) {
      if (value === h) {
        return true;
      }
    }
  }
  return false;
}

/**
 * @param {object|null|undefined} objJson
 * @returns {string|null}
 */
export function resolveDomainIdForSceneDeployRoot(objJson) {
  if (!objJson || typeof objJson !== "object" || Array.isArray(objJson)) {
    return null;
  }
  const objType = String(objJson.objType || objJson.type || "").trim();
  if (objType === "domain" && objJson.domain) {
    const domainId = String(objJson.domain).trim();
    return domainId || null;
  }
  initBusinessDomains();
  for (const domain of listRegisteredDomains()) {
    const matchFn = domain.api?.matchesSceneDeployRootObjJson;
    if (typeof matchFn === "function" && matchFn(objJson)) {
      return domain.id;
    }
    const config = domain.legacyBoxObjTypes;
    if (!config) {
      continue;
    }
    if (Array.isArray(config) && config.includes(objType)) {
      return domain.id;
    }
    if (typeof config === "object" && typeof config[objType] === "string" && config[objType]) {
      return domain.id;
    }
  }
  return null;
}

/**
 * @param {object} boxModel
 * @returns {string[]}
 */
function legacyDomainLookupKeys(boxModel) {
  const keys = [];
  if (typeof boxModel?.handler === "string" && boxModel.handler.trim()) {
    keys.push(boxModel.handler.trim());
  }
  if (typeof boxModel?.objType === "string" && boxModel.objType.trim()) {
    keys.push(boxModel.objType.trim());
  }
  return keys;
}

/**
 * @param {object} boxModel
 * @returns {{ domain: string, handler: string } | null}
 */
export function resolveLegacyDomainHandlerForBoxModel(boxModel) {
  initBusinessDomains();
  const keys = legacyDomainLookupKeys(boxModel);
  for (let ki = 0; ki < keys.length; ki++) {
    const legacyType = keys[ki];
    if (!legacyType || normalizeObjTypeLocal(legacyType) === "domain") {
      continue;
    }
    for (const domain of listRegisteredDomains()) {
      const config = domain.legacyBoxObjTypes;
      if (!config) {
        continue;
      }
      if (Array.isArray(config)) {
        if (config.includes(legacyType)) {
          return { domain: domain.id, handler: legacyType };
        }
        continue;
      }
      if (typeof config === "object" && typeof config[legacyType] === "string" && config[legacyType]) {
        return { domain: domain.id, handler: config[legacyType] };
      }
    }
  }
  return null;
}

/**
 * @param {import("three").Scene} scene
 * @param {object} record
 * @param {{ domain: string, handler: string }} legacy
 * @param {object} [ctx]
 * @returns {boolean}
 */
function deployViaDomainResolver(scene, record, legacy, ctx) {
  const domain = getDomain(legacy.domain);
  if (!domain || typeof domain.resolveDomainModel !== "function") {
    log.warn("[deployMeshWithDomains] unknown or invalid domain:", legacy.domain);
    return false;
  }
  const domainRecord = { ...record };
  domainRecord.objType = "domain";
  domainRecord.domain = legacy.domain;
  domainRecord.handler = legacy.handler;
  domain.resolveDomainModel(domainRecord, scene, ctx);
  return true;
}

/**
 * @param {object} meshRecord
 * @param {import("three").Scene} _scene
 * @param {object} [ctx]
 * @returns {import("three").Object3D|null}
 */
export function tryComposeBoxModel(meshRecord, _scene, ctx) {
  initBusinessDomains();
  for (const domain of listRegisteredDomains()) {
    if (typeof domain.composeBoxModel !== "function") {
      continue;
    }
    const obj = domain.composeBoxModel(meshRecord, ctx);
    if (obj) {
      return obj;
    }
  }
  return null;
}

/**
 * @param {import("three").Scene} scene
 * @param {object} meshRecord
 * @param {object} [ctx]
 */
export function deployMeshWithDomains(scene, meshRecord, ctx) {
  if (!scene || !meshRecord) {
    return;
  }
  const legacy = resolveLegacyDomainHandlerForBoxModel(meshRecord);
  if (legacy) {
    deployViaDomainResolver(scene, meshRecord, legacy, ctx);
    return;
  }
  let composeMatched = false;
  if (isComposeBoxModelEnabled(ctx)) {
    const composed = tryComposeBoxModel(meshRecord, scene, ctx);
    if (composed) {
      scene.add(composed);
      composeMatched = true;
    }
  }
  if (composeMatched) {
    return;
  }
  if (isCoreMeshPrimitiveObjType(meshRecord)) {
    deployMesh(meshRecord, scene);
    return;
  }
  if (shouldTryNativeFallback(meshRecord, ctx)) {
    if (deployNativeObjectRecord(scene, meshRecord, ctx)) {
      return;
    }
  }
  if (isDefaultModelEnabled(ctx)) {
    deployAsDefaultModel(scene, meshRecord, ctx);
    return;
  }
  log.warn(
    "[deployMeshWithDomains] unrecognized objType, skipped; use a core official type, domain+handler, or enable sceneConfig.enableComposeBoxModel / enableDefaultModel:",
    meshRecord?.objType,
    meshRecord?.name || ""
  );
}

/**
 * @param {import("three").Scene} scene
 * @param {object[]} meshList
 * @param {object} [ctx]
 */
export function deployMeshListWithDomains(scene, meshList, ctx) {
  if (!scene || !meshList?.length) {
    return;
  }
  for (let i = 0; i < meshList.length; i++) {
    deployMeshWithDomains(scene, meshList[i], ctx);
  }
}

/**
 * @param {string} qualifiedPrefix
 * @returns {object}
 */
function createDomainNavigationProxy(qualifiedPrefix) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "toJSON" || prop === Symbol.toStringTag) {
          return undefined;
        }
        const segment = String(prop);
        if (!segment || segment === "then") {
          return undefined;
        }
        const qualified = qualifiedPrefix ? `${qualifiedPrefix}.${segment}` : segment;
        const domain = getDomain(qualified);
        if (domain?.api) {
          return wrapDomainApi(qualified, domain.api);
        }
        if (hasRegisteredDescendant(qualified)) {
          return createDomainNavigationProxy(qualified);
        }
        return undefined;
      }
    }
  );
}

/**
 * @param {string} qualifiedId
 * @param {Record<string, Function>} api
 * @returns {Record<string, Function>}
 */
function wrapDomainApi(qualifiedId, api) {
  if (!api || typeof api !== "object") {
    return api;
  }
  return new Proxy(api, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return target[/** @type {string} */ (prop)];
      }
      const segment = String(prop);
      if (!segment || segment === "then") {
        return undefined;
      }
      const childQualified = `${qualifiedId}.${segment}`;
      const child = getDomain(childQualified);
      if (child?.api) {
        return wrapDomainApi(childQualified, child.api);
      }
      if (hasRegisteredDescendant(childQualified)) {
        return createDomainNavigationProxy(childQualified);
      }
      return undefined;
    }
  });
}

export function getBusinessDomainApi() {
  initBusinessDomains();
  /** @type {Record<string, object>} */
  const out = {};
  for (const [id, domain] of domainById.entries()) {
    if (!domain.api || typeof domain.api !== "object") {
      continue;
    }
    if (id.includes(".")) {
      continue;
    }
    out[id] = wrapDomainApi(id, domain.api);
  }
  for (const prefix of navigationPrefixIds) {
    if (!prefix.includes(".") && !out[prefix] && hasRegisteredDescendant(prefix)) {
      out[prefix] = createDomainNavigationProxy(prefix);
    }
  }
  return out;
}

export const businessDomains = new Proxy(
  {},
  {
    get(_target, prop) {
      initBusinessDomains();
      if (prop === "toJSON" || prop === Symbol.toStringTag) {
        return undefined;
      }
      const key = String(prop);
      if (!key || key === "then") {
        return undefined;
      }
      if (key.includes(".")) {
        const domain = getDomain(key);
        return domain?.api ? wrapDomainApi(key, domain.api) : undefined;
      }
      if (domainById.has(key)) {
        const domain = domainById.get(key);
        return domain?.api ? wrapDomainApi(key, domain.api) : undefined;
      }
      if (hasRegisteredDescendant(key)) {
        return createDomainNavigationProxy(key);
      }
      return undefined;
    }
  }
);

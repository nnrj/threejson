import { cloneDocumentData, createSceneDocument, applyDocumentOperations, documentError } from "./sceneDocument.js";

export const DOMAIN_PART_SCHEMA_VERSION = 1;

export function readDomainOverrides(source) {
  return source?.domainOverrides || source?.items?.[0]?.domainOverrides || source?.payload?.domainOverrides;
}

/**
 * Factories call this after constructing their semantic descriptor tree. Names
 * and explicit part IDs are preferred; unnamed generated entries use the factory's
 * deterministic construction slot. A factory changing that identity contract must
 * increment partSchemaVersion, independently of dimensional parameter changes.
 */
export function assignDomainPartIds(group, options = {}) {
  const namespace = options.namespace || "parts";
  const visit = (record, parentId) => {
    const counts = new Map();
    for (const [i, child] of (record.subScene || []).entries()) {
      if (!child || typeof child !== "object") continue;
      const key = String(child.domainPartId || child.refName || child.name || `${child.objType || "part"}@${i}`);
      const occurrence = counts.get(key) || 0;
      counts.set(key, occurrence + 1);
      const segment = encodeURIComponent(key) + (occurrence ? `#${occurrence}` : "");
      child.domainPartId ||= `${parentId}/${segment}`;
      visit(child, child.domainPartId);
    }
  };
  visit(group, namespace);
  return group;
}

export function indexDomainPartDescriptors(group) {
  const index = new Map();
  const visit = (record) => {
    for (const child of record?.subScene || []) {
      if (!child || typeof child !== "object") continue;
      if (child.domainPartId) {
        if (index.has(child.domainPartId)) throw documentError("DOMAIN_PART_CONFLICT", `Duplicate Domain part: ${child.domainPartId}.`);
        index.set(child.domainPartId, child);
      }
      visit(child);
    }
  };
  visit(group);
  return index;
}

/** Apply authoring overrides before geometry/material compilation, not by reverse inference. */
export function applyDomainPartDescriptorOverrides(group, source, options = {}) {
  const overrides = readDomainOverrides(source);
  if (!overrides) return group;
  const expected = options.partSchemaVersion || DOMAIN_PART_SCHEMA_VERSION;
  if (overrides.partSchemaVersion !== expected) throw documentError("DOMAIN_PART_VERSION_CONFLICT", `Domain part schema ${overrides.partSchemaVersion} does not match factory schema ${expected}.`, { expected, actual: overrides.partSchemaVersion });
  if (!Array.isArray(overrides.parts)) throw documentError("DOMAIN_PART_CONFLICT", "domainOverrides.parts must be an array.");
  // Work on a private tree so an invalid later operation cannot leave an earlier
  // part half modified. Structural edits require a new factory schema or baking.
  const working = cloneDocumentData(group);
  const parts = indexDomainPartDescriptors(working);
  const seen = new Set();
  const prepared = [];
  const routed = [];
  for (const override of overrides.parts) {
    let record = parts.get(override.id);
    if (seen.has(override.id)) throw documentError("DOMAIN_PART_CONFLICT", `Duplicate Domain override target: ${override.id}.`, { partId: override.id });
    seen.add(override.id);
    if (!record) {
      // Nested factories (e.g. a cabinet door's leaf) own their generated parts.
      // Route by the explicit parent address; that factory validates the suffix.
      const parent = [...parts.entries()].filter(([id, part]) =>
        override.id?.startsWith(`${id}/`) && (options.isNestedFactory?.(part) || part.objType === "domain")
      ).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
      if (!parent) throw documentError("DOMAIN_PART_CONFLICT", `Missing Domain override target: ${override.id}.`, { partId: override.id });
      routed.push({ parent, override });
      continue;
    }
    for (const operation of override.operations || []) {
      if (!operation.path || /^\/(?:subScene|boxModelList|subGroup|domainOverrides|domainPartId|threeJsonId)(?:\/|$)/u.test(operation.path)) {
        throw documentError("DOMAIN_PART_CONFLICT", "Structural and identity changes require a factory parameter edit or explicit bake.", { partId: override.id });
      }
    }
    const result = applyDocumentOperations(createSceneDocument(record), override.operations || []);
    if (result.document.root.domainPartId !== record.domainPartId || result.document.root.threeJsonId !== record.threeJsonId) {
      throw documentError("DOMAIN_PART_ID_IMMUTABLE", "An override cannot change a part's identity.");
    }
    prepared.push({ record, next: cloneDocumentData(result.document.root) });
  }
  for (const { record, next } of prepared) {
    // Children have their own addresses. Retain this private tree's child objects
    // when patching a parent's material/parameters, so sibling preparations do
    // not accidentally target a detached clone.
    if (record.subScene) next.subScene = record.subScene;
    for (const key of Object.keys(record)) delete record[key];
    Object.assign(record, next);
  }
  for (const { parent, override } of routed) {
    parent.domainOverrides ||= { partSchemaVersion: expected, parts: [] };
    parent.domainOverrides.parts.push(cloneDocumentData(override));
  }
  for (const key of Object.keys(group)) delete group[key];
  Object.assign(group, working);
  return group;
}

/** Minimal JSON operations between two descriptions; unchanged dense arrays are not serialized. */
export function diffDomainPartData(before, after, path = "", result = []) {
  if (before === after) return result;
  const record = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (record(before) && record(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const pointer = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      if (!Object.hasOwn(after, key)) result.push({ op: "remove", path: pointer });
      else if (!Object.hasOwn(before, key)) result.push({ op: "add", path: pointer, value: cloneDocumentData(after[key]) });
      else diffDomainPartData(before[key], after[key], pointer, result);
    }
  } else if (JSON.stringify(before) !== JSON.stringify(after)) result.push({ op: "replace", path, value: cloneDocumentData(after) });
  return result;
}

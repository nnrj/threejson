import { cloneDocumentData, documentError } from "../document/sceneDocument.js";
import { DOMAIN_PART_SCHEMA_VERSION, diffDomainPartData, readDomainOverrides } from "../document/domainParts.js";

const states = new WeakMap();
const runtimeId = (object) => object.userData?.objJson?.domainPartId || object.userData?.objJson?.threeJsonId || object.uuid;

function visitParts(root, callback) {
  const stack = [...root.children];
  while (stack.length) {
    const object = stack.pop();
    if (object.userData?.__threeJsonRuntimeOnly || object.userData?.__threeJsonExportExcluded || object.isTransformControls ||
      object.userData?.type === "helperBoxEdge" || ["AxesHelper", "GridHelper", "BoxHelper"].includes(object.type)) continue;
    callback(object);
    stack.push(...object.children);
  }
}

function localState(object) {
  return { position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray() };
}

function partDescriptor(object) {
  const record = cloneDocumentData(object.userData?.objJson || {});
  // Pose is recorded in explicit local runtime space, important for hinge/pivot wrappers.
  for (const key of ["position", "rotation", "quaternion", "scale", "visible", "threeJsonId", "domainPartId", "jsonOrigin", "subScene", "subGroup", "boxModelList", "domainOverrides"]) delete record[key];
  return record;
}

function collectParts(root) {
  const parts = new Map();
  visitParts(root, (object) => {
    const record = object.userData?.objJson;
    // Explicit stable IDs also support third-party factories incrementally. UUIDs
    // cannot be used as persisted part addresses across reloads.
    const explicitId = record?.threeJsonId;
    const id = record?.domainPartId || object.userData?.domainPartId ||
      (typeof explicitId === "string" && !/^[\da-f]{8}-[\da-f-]{27}$/iu.test(explicitId) ? `id:${explicitId}` : null);
    if (!id) return;
    if (parts.has(id)) throw documentError("DOMAIN_PART_CONFLICT", `Duplicate runtime Domain part: ${id}.`, { partId: id });
    parts.set(id, { object, parent: object.parent, runtimeId: runtimeId(object), transform: localState(object), visible: object.visible, descriptor: partDescriptor(object) });
  });
  return parts;
}

function validateTransform(transform) {
  if (!transform) return;
  for (const [field, length] of [["position", 3], ["quaternion", 4], ["scale", 3]]) {
    if (transform[field] === undefined) continue;
    if (!Array.isArray(transform[field]) || transform[field].length !== length || transform[field].some((n) => !Number.isFinite(n))) throw documentError("DOMAIN_PART_CONFLICT", `Invalid Domain part ${field}.`);
  }
  if (transform.quaternion && Math.hypot(...transform.quaternion) === 0) throw documentError("DOMAIN_PART_CONFLICT", "Domain part quaternion cannot be zero.");
}

function applyLocalTransform(object, transform) {
  if (!transform) return;
  if (transform.position) object.position.fromArray(transform.position);
  if (transform.quaternion) object.quaternion.fromArray(transform.quaternion).normalize();
  if (transform.scale) object.scale.fromArray(transform.scale);
  object.updateMatrix(); object.updateMatrixWorld(true);
}

/** Called only once a factory has finished adding its children. */
export function initializeDomainPartState(root, source, options = {}) {
  const parts = collectParts(root);
  const overrides = readDomainOverrides(source);
  const expected = options.partSchemaVersion || DOMAIN_PART_SCHEMA_VERSION;
  if (overrides && overrides.partSchemaVersion !== expected) throw documentError("DOMAIN_PART_VERSION_CONFLICT", "Domain overrides need an explicit part-version migration.");
  if (overrides && !Array.isArray(overrides.parts)) throw documentError("DOMAIN_PART_CONFLICT", "domainOverrides.parts must be an array.");
  const pending = [];
  const seen = new Set();
  for (const override of overrides?.parts || []) {
    const part = parts.get(override.id);
    if (!part || seen.has(override.id)) throw documentError("DOMAIN_PART_CONFLICT", `Missing or duplicate Domain part: ${override.id}.`, { partId: override.id });
    seen.add(override.id);
    validateTransform(override.transform);
    if (override.operations?.length && !options.descriptorOverridesApplied) throw documentError("DOMAIN_PART_CONFLICT", "Factory must apply descriptor overrides before compiling its parts.");
    pending.push({ part, override });
  }
  const structure = new Map();
  const addressed = new Set([...parts.values()].map((part) => part.object));
  const unaddressed = new Map();
  visitParts(root, (object) => {
    structure.set(object, object.parent);
    if (!addressed.has(object)) unaddressed.set(object, { transform: localState(object), visible: object.visible, descriptor: partDescriptor(object) });
  });
  // Store the factory baseline independently of userData, snapshots and animation.
  states.set(root, { parts, structure, unaddressed, source: cloneDocumentData(overrides || { partSchemaVersion: expected, parts: [] }) });
  for (const { part, override } of pending) {
    applyLocalTransform(part.object, override.transform);
    if (typeof override.visible === "boolean") part.object.visible = override.visible;
  }
  return root;
}

/** Explicit authoring capture, never called from frame/animation updates. */
export function captureDomainPartOverrides(root, options = {}) {
  const baseline = states.get(root);
  if (!baseline) throw documentError("DOMAIN_PART_CONFLICT", "Factory has no stable part baseline; bake or supply a part adapter.");
  const current = collectParts(root);
  const structure = new Map();
  visitParts(root, (object) => structure.set(object, object.parent));
  if (structure.size !== baseline.structure.size || [...structure].some(([object, parent]) => baseline.structure.get(object) !== parent)) {
    throw documentError("DOMAIN_PART_CONFLICT", "Domain structure changed; use a factory parameter edit or explicitly bake it.");
  }
  for (const [object, before] of baseline.unaddressed) {
    const id = runtimeId(object);
    const moved = options.childBaseline?.[id]
      ? JSON.stringify(options.childBaseline[id]) !== JSON.stringify(options.currentTransforms?.[id])
      : JSON.stringify(before.transform) !== JSON.stringify(localState(object));
    if (moved || before.visible !== object.visible || diffDomainPartData(before.descriptor, partDescriptor(object)).length) {
      throw documentError("DOMAIN_PART_CONFLICT", "Edited part has no stable factory address; supply a part adapter or explicitly bake it.");
    }
  }
  const oldOverrides = new Map(baseline.source.parts.map((part) => [part.id, part]));
  const parts = [];
  if (current.size !== baseline.parts.size) throw documentError("DOMAIN_PART_CONFLICT", "Domain structure changed; use a factory parameter edit or explicitly bake it.");
  for (const [id, before] of baseline.parts) {
    const after = current.get(id);
    if (!after || after.object !== before.object || after.parent !== before.parent) throw documentError("DOMAIN_PART_CONFLICT", `Domain part structure changed: ${id}.`, { partId: id });
    const prior = oldOverrides.get(id);
    const operations = [...(prior?.operations || []), ...diffDomainPartData(before.descriptor, after.descriptor)];
    // A caller can supply the drill-in baseline to avoid counting playback before
    // editing as an authored pose. Explicitly captured transforms remain absolute.
    const observed = options.childBaseline?.[before.runtimeId];
    const moved = observed ? JSON.stringify(observed) !== JSON.stringify(options.currentTransforms?.[before.runtimeId])
      : JSON.stringify(before.transform) !== JSON.stringify(after.transform);
    const transform = moved ? after.transform : prior?.transform;
    const visible = before.visible !== after.visible ? after.visible : prior?.visible;
    if (operations.length || transform || visible !== undefined) parts.push({ id, ...(operations.length ? { operations } : {}), ...(transform ? { transform } : {}), ...(visible !== undefined ? { visible } : {}) });
  }
  return { partSchemaVersion: baseline.source.partSchemaVersion, parts };
}

export function getDomainPartDiagnostics(root) {
  try { captureDomainPartOverrides(root); return []; }
  catch (error) { return [{ code: error.code || "DOMAIN_PART_CONFLICT", message: error.message, partId: error.partId }]; }
}

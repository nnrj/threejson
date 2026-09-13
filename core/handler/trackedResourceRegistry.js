/**
 * Non-owning diagnostic/emergency-disposal index. Scene/resource leases own lifetimes.
 * A process-wide strong Set retained every retired geometry and decoded image forever.
 * Tracking must neither keep discarded resources alive nor dispose sibling scenes.
 */
const entries = new Set();
let byResource = new WeakMap();
const finalized = typeof FinalizationRegistry === "function"
  ? new FinalizationRegistry((entry) => entries.delete(entry)) : null;

export function trackDisposableResource(resource) {
  if (Array.isArray(resource)) { for (const item of resource) trackDisposableResource(item); return resource; }
  if (!resource || !["object", "function"].includes(typeof resource) || byResource.has(resource)) return resource;
  // On older hosts, only explicit scene ownership participates in disposal.
  if (typeof WeakRef !== "function") return resource;
  const entry = { reference: new WeakRef(resource), onDispose: null };
  entry.onDispose = () => untrackDisposableResource(resource);
  resource.addEventListener?.("dispose", entry.onDispose);
  // Do not store the listener in the global index: its closure would retain the resource.
  const onDispose = entry.onDispose; delete entry.onDispose;
  byResource.set(resource, { entry, onDispose }); entries.add(entry);
  finalized?.register(resource, entry, entry);
  return resource;
}

export function untrackDisposableResource(resource) {
  if (Array.isArray(resource)) { for (const item of resource) untrackDisposableResource(item); return; }
  const record = resource && byResource.get(resource);
  if (!record) return;
  resource.removeEventListener?.("dispose", record.onDispose);
  entries.delete(record.entry); finalized?.unregister(record.entry); byResource.delete(resource);
}

const bucket = {
  *[Symbol.iterator]() {
    for (const entry of entries) {
      const resource = entry.reference.deref();
      if (resource) yield resource; else entries.delete(entry);
    }
  },
  get size() { let count = 0; for (const _ of this) count++; return count; },
  has(resource) { return byResource.has(resource); },
  clear() {
    for (const resource of this) untrackDisposableResource(resource);
    entries.clear(); byResource = new WeakMap();
  }
};

/** Iterable live resources; this index does not own their lifetime. */
export function getTrackedResourceBucketForDispose() { return bucket; }

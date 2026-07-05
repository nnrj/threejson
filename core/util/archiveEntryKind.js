function isObjectRecordEntry(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof value.objType === "string"
    && value.objType.trim().length > 0
  );
}

function isScenePayloadEntry(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (
      Array.isArray(value.objectList)
      || (value.worldInfo && typeof value.worldInfo === "object")
      || (value.sceneConfig && typeof value.sceneConfig === "object")
    )
  );
}

function normalizeEntryKind(rawKind, fallback = "unknown") {
  const kind = String(rawKind || "").trim().toLowerCase();
  if (kind === "scene" || kind === "object") {
    return kind;
  }
  return fallback;
}

function detectArchiveEntryKindFromPayload(payload) {
  if (isObjectRecordEntry(payload)) {
    return "object";
  }
  if (isScenePayloadEntry(payload)) {
    return "scene";
  }
  return "unknown";
}

function resolveArchiveEntryKind({ manifest, payload } = {}) {
  const fromManifest = normalizeEntryKind(manifest?.entryKind, "");
  if (fromManifest) {
    return fromManifest;
  }
  return detectArchiveEntryKindFromPayload(payload);
}

export {
  detectArchiveEntryKindFromPayload,
  isObjectRecordEntry,
  isScenePayloadEntry,
  normalizeEntryKind,
  resolveArchiveEntryKind
};

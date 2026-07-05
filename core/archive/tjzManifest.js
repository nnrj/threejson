import { normalizeArchivePath } from "../util/archiveCommon.js";

function normalizeMissingAssetPolicy(manifest = {}) {
  const policy = String(manifest?.missingAssetPolicy || "").trim().toLowerCase();
  return policy === "error" ? "error" : "warn";
}

function normalizeEntryKind(kind, fallback = "scene") {
  const normalized = String(kind || "").trim().toLowerCase();
  if (normalized === "scene" || normalized === "object") {
    return normalized;
  }
  return fallback;
}

function normalizeTjzManifest(input = {}) {
  const out = {
    format: "threejson-archive",
    version: 1,
    entry: "scene.json",
    missingAssetPolicy: "warn",
    entryKind: "scene"
  };
  if (input && typeof input === "object") {
    if (typeof input.format === "string" && input.format.trim()) {
      out.format = input.format.trim();
    }
    if (Number.isFinite(input.version)) {
      out.version = Number(input.version);
    }
    if (typeof input.entry === "string" && input.entry.trim()) {
      out.entry = normalizeArchivePath(input.entry);
    }
    out.missingAssetPolicy = normalizeMissingAssetPolicy(input);
    if (typeof input.createdAt === "string") {
      out.createdAt = input.createdAt;
    }
    if (typeof input.generator === "string") {
      out.generator = input.generator;
    }
    if (typeof input.notes === "string") {
      out.notes = input.notes;
    }
    out.entryKind = normalizeEntryKind(input.entryKind, out.entryKind);
  }
  return out;
}

function resolveArchiveEntryPath(manifest, fileMap) {
  const byManifest = normalizeArchivePath(manifest?.entry || "");
  if (byManifest && fileMap.has(byManifest)) {
    return byManifest;
  }
  if (fileMap.has("scene.json")) {
    return "scene.json";
  }
  return "";
}

export {
  normalizeEntryKind,
  normalizeMissingAssetPolicy,
  normalizeTjzManifest,
  resolveArchiveEntryPath
};

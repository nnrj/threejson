import { normalizeScenePayload, buildStandardScenePayloadFromCanonical, buildFriendlyScenePayloadFromCanonical, detectScenePayloadViewFormat } from "../handler/sceneFriendlyNormalizer.js";
import { cloneDocumentData, createSceneDocument, isSceneDocument, indexSceneDocument, SCENE_DOCUMENT_VERSION } from "./sceneDocument.js";

/** Compile supported authoring forms without consulting or capturing a live scene. */
export function compileAuthoring(payload, options = {}) {
  if (isSceneDocument(payload)) return payload;
  const source = cloneDocumentData(payload);
  // Validate the envelope before an adapter can normalize away an unsupported version.
  createSceneDocument(source);
  const normalized = normalizeScenePayload(source, options);
  const root = buildStandardScenePayloadFromCanonical(normalized.sourcePayload, normalized.payload);
  // Empty scenes are meaningful (including explicit deletion of the last object).
  root.objectList ||= [];
  const document = createSceneDocument(root, { ...options, sourceFormat: detectScenePayloadViewFormat(source) });
  indexSceneDocument(document);
  return document;
}

export function formatAuthoring(document, options = {}) {
  if (!isSceneDocument(document)) document = compileAuthoring(document);
  const standard = cloneDocumentData(document.root);
  standard.schemaVersion = SCENE_DOCUMENT_VERSION;
  const format = options.format || document.sourceFormat;
  if (format !== "friendly") return standard;
  const normalized = normalizeScenePayload(standard);
  return buildFriendlyScenePayloadFromCanonical(standard, normalized.payload, options);
}

/** Read-only migration report. Persistence and backup decisions remain with the host. */
export function inspectAuthoringMigration(payload) {
  const document = compileAuthoring(payload);
  return { fromVersion: payload.schemaVersion ?? 1, toVersion: SCENE_DOCUMENT_VERSION,
    format: document.sourceFormat, document, changes: payload.schemaVersion === SCENE_DOCUMENT_VERSION ? [] : ["Add schemaVersion:2 when explicitly saving the adapted document."] };
}

import { createSceneDocument, applyDocumentOperations, cloneDocumentData } from "../../document/sceneDocument.js";
import { buildCommandResult } from "../types.js";

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} args
 */
export function handleSceneApplyPatch(ctx, args = {}) {
  const patch = Array.isArray(args.patch) ? args.patch : null;
  if (!patch || patch.length === 0) {
    return buildCommandResult("scene.applyPatch", {
      ok: false,
      mode: "document",
      error: "scene.applyPatch requires args.patch array."
    });
  }
  const base = isObjectRecord(args.json)
    ? args.json
    : isObjectRecord(ctx.document)
      ? ctx.document
      : null;
  if (!base) {
    return buildCommandResult("scene.applyPatch", {
      ok: false,
      mode: "document",
      error: "scene.applyPatch requires args.json or ctx.document."
    });
  }
  let document;
  try {
    document = applyDocumentOperations(createSceneDocument(base), patch).document;
  } catch (error) {
    return buildCommandResult("scene.applyPatch", {
      ok: false,
      mode: "document",
      error: error.message || "patch failed"
    });
  }
  ctx.document = cloneDocumentData(document.root);
  return buildCommandResult("scene.applyPatch", {
    ok: true,
    mode: "document",
    data: { json: ctx.document, patchCount: patch.length }
  });
}

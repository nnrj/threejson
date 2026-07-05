import { applySceneJsonPatch } from "../../ai/scenePatch.js";
import { buildCommandResult } from "../types.js";

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
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
  const applied = applySceneJsonPatch(base, patch);
  if (!applied.ok) {
    return buildCommandResult("scene.applyPatch", {
      ok: false,
      mode: "document",
      error: applied.error || "patch failed"
    });
  }
  ctx.document = cloneJson(applied.scene);
  return buildCommandResult("scene.applyPatch", {
    ok: true,
    mode: "document",
    data: { json: ctx.document, patchCount: patch.length }
  });
}

import { validateSceneJson } from "../../handler/sceneJsonValidate.js";
import { createJsonScene, createJsonSceneSimple } from "../../handler/sceneLoadHandler.js";
import { resolveParentThreeJsonId } from "../../runtime/sceneObjectCommands.js";
import { sceneToStandardJsonSimple } from "../../util/sceneToJson.js";
import { buildCommandResult } from "../types.js";

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

/**
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} deployed
 * @param {object} payload
 */
function updateContextFromDeployed(ctx, deployed, payload) {
  if (deployed?.scene?.isScene) {
    ctx.scene = deployed.scene;
  }
  if (deployed?.camera) {
    ctx.camera = deployed.camera;
  }
  if (deployed?.renderer) {
    ctx.renderer = deployed.renderer;
  }
  if (deployed?.controls) {
    ctx.controls = deployed.controls;
  }
  ctx.document = cloneJson(
    deployed?.normalizedPayload || deployed?.sceneJson || payload || ctx.document
  );
}

/**
 * @param {object} args
 * @param {import("../types.js").CommandContext} ctx
 */
function resolveScenePayload(args, ctx) {
  if (isObjectRecord(args?.json)) {
    return args.json;
  }
  if (isObjectRecord(ctx.document)) {
    return ctx.document;
  }
  return null;
}

/**
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} args
 */
export async function handleSceneLoad(ctx, args = {}) {
  const payload = resolveScenePayload(args, ctx);
  if (!payload) {
    return buildCommandResult("scene.load", {
      ok: false,
      mode: "runtime",
      error: 'scene.load requires args.json or ctx.document.'
    });
  }

  const loadOptions = isObjectRecord(args.options) ? args.options : {};
  try {
    const deployed =
      args.sync === true
        ? createJsonSceneSimple(payload, loadOptions)
        : await createJsonScene(payload, loadOptions);
    updateContextFromDeployed(ctx, deployed, payload);
    return buildCommandResult("scene.load", {
      ok: true,
      mode: "runtime",
      data: {
        hasScene: Boolean(ctx.scene?.isScene),
        objectCount: ctx.scene?.children?.length ?? 0
      }
    });
  } catch (err) {
    return buildCommandResult("scene.load", {
      ok: false,
      mode: "runtime",
      error: String(err?.message || err)
    });
  }
}

/**
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} args
 */
export function handleSceneValidate(ctx, args = {}) {
  const payload = resolveScenePayload(args, ctx);
  if (!payload) {
    return buildCommandResult("scene.validate", {
      ok: false,
      mode: "document",
      error: 'scene.validate requires args.json or ctx.document.'
    });
  }
  const validation = validateSceneJson(JSON.stringify(payload));
  return buildCommandResult("scene.validate", {
    ok: validation.ok,
    mode: "document",
    data: validation.ok
      ? {
          boxCount: validation.boxCount,
          objectCount: validation.objectCount,
          friendlyCount: validation.friendlyCount,
          usage: validation.usage
        }
      : undefined,
    error: validation.ok ? null : validation.error || "validation failed"
  });
}

/**
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} args
 */
export async function handleSceneExport(ctx, args = {}) {
  if (!ctx.scene?.isScene) {
    return buildCommandResult("scene.export", {
      ok: false,
      mode: "runtime",
      error: "scene.export requires ctx.scene (runtime mode)."
    });
  }
  const format = typeof args.format === "string" ? args.format.trim().toLowerCase() : "standard";
  if (format !== "standard") {
    return buildCommandResult("scene.export", {
      ok: false,
      mode: "runtime",
      error: `unsupported export format "${format}".`
    });
  }
  const exportOptions = isObjectRecord(args.options) ? args.options : {};
  try {
    const basePayload = isObjectRecord(ctx.document) ? ctx.document : {};
    const json = sceneToStandardJsonSimple(ctx.scene, {
      ...exportOptions,
      basePayload
    });
    ctx.document = cloneJson(json);
    return buildCommandResult("scene.export", {
      ok: true,
      mode: "runtime",
      data: { format: "standard", json }
    });
  } catch (err) {
    return buildCommandResult("scene.export", {
      ok: false,
      mode: "runtime",
      error: String(err?.message || err)
    });
  }
}

/**
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} [_args]
 */
export function handleSceneList(ctx, _args = {}) {
  if (!ctx.scene?.isScene) {
    return buildCommandResult("scene.list", {
      ok: false,
      mode: "runtime",
      error: "scene.list requires ctx.scene (runtime mode)."
    });
  }
  const items = [];
  const seen = new Set();
  ctx.scene.traverse((node) => {
    const descriptor = node?.userData?.objJson;
    if (!isObjectRecord(descriptor)) {
      return;
    }
    const id = typeof descriptor.threeJsonId === "string" ? descriptor.threeJsonId.trim() : "";
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    const parentThreeJsonId = resolveParentThreeJsonId(node);
    items.push({
      threeJsonId: id,
      name: typeof descriptor.name === "string" ? descriptor.name : "",
      objType: typeof descriptor.objType === "string" ? descriptor.objType : "",
      ...(parentThreeJsonId ? { parentThreeJsonId } : {})
    });
  });
  return buildCommandResult("scene.list", {
    ok: true,
    mode: "runtime",
    data: { count: items.length, items }
  });
}

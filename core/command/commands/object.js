import { getObjectByThreeJsonId } from "../../handler/objectRegistry.js";
import { reconcileTransformToDescriptor } from "../../handler/descriptorSync.js";
import { getByPath } from "../../util/jsonPointer.js";
import {
  applyObjectChange,
  applyObjectPartial,
  applyObjectPartialAsync
} from "../../runtime/objectMutation/index.js";
import {
  addObjectFromDescriptor,
  addObjectFromDescriptorAsync,
  removeObjectById
} from "../../runtime/sceneObjectCommands.js";
import { buildCommandResult } from "../types.js";

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function requireScene(ctx, op) {
  if (!ctx.scene?.isScene) {
    return buildCommandResult(op, {
      ok: false,
      mode: "runtime",
      error: `${op} requires ctx.scene (runtime mode).`
    });
  }
  return null;
}

function mapMutationResult(op, res, extra = {}) {
  return buildCommandResult(op, {
    ok: Boolean(res?.ok),
    mode: "runtime",
    data: res?.ok
      ? {
          threeJsonId: res.threeJsonId || extra.threeJsonId || "",
          needsRedeploy: Boolean(res.needsRedeploy),
          needsAsync: Boolean(res.needsAsync),
          ...extra.data
        }
      : undefined,
    error: res?.ok ? null : res?.error || "mutation failed"
  });
}

/**
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} args
 */
export async function handleObjectAdd(ctx, args = {}) {
  const sceneError = requireScene(ctx, "object.add");
  if (sceneError) {
    return sceneError;
  }
  if (!isObjectRecord(args.descriptor)) {
    return buildCommandResult("object.add", {
      ok: false,
      mode: "runtime",
      error: "object.add requires args.descriptor object."
    });
  }
  const options = isObjectRecord(args.options) ? { ...args.options } : {};
  if (args.parent != null) {
    options.parent = args.parent;
  }
  let res = addObjectFromDescriptor(ctx.scene, args.descriptor, options);
  if (res.ok && res.needsAsync) {
    res = await addObjectFromDescriptorAsync(ctx.scene, args.descriptor, options);
  } else if (!res.ok && res.needsAsync) {
    res = await addObjectFromDescriptorAsync(ctx.scene, args.descriptor, options);
  }
  return mapMutationResult("object.add", res);
}

/**
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} args
 */
export function handleObjectRemove(ctx, args = {}) {
  const sceneError = requireScene(ctx, "object.remove");
  if (sceneError) {
    return sceneError;
  }
  const id = String(args.id ?? "").trim();
  if (!id) {
    return buildCommandResult("object.remove", {
      ok: false,
      mode: "runtime",
      error: "object.remove requires args.id."
    });
  }
  const options = isObjectRecord(args.options) ? args.options : {};
  const res = removeObjectById(ctx.scene, id, options);
  return buildCommandResult("object.remove", {
    ok: Boolean(res?.ok),
    mode: "runtime",
    data: res?.ok
      ? {
          threeJsonId: res.threeJsonId || id,
          protected: Boolean(res.protected),
          removedDescriptor: res.removedDescriptor ? cloneJson(res.removedDescriptor) : null
        }
      : undefined,
    error: res?.ok ? null : res?.error || "remove failed"
  });
}

/**
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} args
 */
export async function handleObjectPatch(ctx, args = {}) {
  const sceneError = requireScene(ctx, "object.patch");
  if (sceneError) {
    return sceneError;
  }
  const id = String(args.id ?? "").trim();
  if (!id) {
    return buildCommandResult("object.patch", {
      ok: false,
      mode: "runtime",
      error: "object.patch requires args.id."
    });
  }
  const options = isObjectRecord(args.options) ? args.options : {};
  if (isObjectRecord(args.partial)) {
    const deferAsync = options.deferAsync === true || options.awaitTextures === false;
    const res = deferAsync
      ? applyObjectPartial(id, args.partial, options)
      : await applyObjectPartialAsync(id, args.partial, options);
    return mapMutationResult("object.patch", res, {
      data: { strategy: "partial", deferAsync: Boolean(deferAsync) }
    });
  }
  if (typeof args.path === "string" && args.path.trim()) {
    const res = applyObjectChange(id, args.path, args.value, options);
    return mapMutationResult("object.patch", res, {
      data: { strategy: "path", path: args.path.trim() }
    });
  }
  return buildCommandResult("object.patch", {
    ok: false,
    mode: "runtime",
    error: "object.patch requires args.partial or args.path."
  });
}

/**
 * Write live Object3D transforms back into objJson descriptors.
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} args
 */
export function handleObjectReconcile(ctx, args = {}) {
  const sceneError = requireScene(ctx, "object.reconcile");
  if (sceneError) {
    return sceneError;
  }
  const options = isObjectRecord(args.options) ? args.options : {};
  const id = String(args.id ?? "").trim();
  if (id) {
    const object3D = getObjectByThreeJsonId(id);
    if (!object3D) {
      return buildCommandResult("object.reconcile", {
        ok: false,
        mode: "runtime",
        error: `Object not found for threeJsonId "${id}".`
      });
    }
    const reconciled = reconcileTransformToDescriptor(object3D, options);
    return buildCommandResult("object.reconcile", {
      ok: reconciled,
      mode: "runtime",
      data: { threeJsonId: id, reconciled, count: reconciled ? 1 : 0 },
      error: reconciled ? null : "reconcileTransformToDescriptor returned false."
    });
  }
  let count = 0;
  ctx.scene.traverse((node) => {
    const descriptor = node?.userData?.objJson;
    if (!isObjectRecord(descriptor)) {
      return;
    }
    const nodeId = typeof descriptor.threeJsonId === "string" ? descriptor.threeJsonId.trim() : "";
    if (!nodeId) {
      return;
    }
    if (reconcileTransformToDescriptor(node, { ...options, markBindingDirty: false })) {
      count += 1;
    }
  });
  return buildCommandResult("object.reconcile", {
    ok: true,
    mode: "runtime",
    data: { count, scope: "scene" }
  });
}

/**
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} args
 */
export function handleObjectGet(ctx, args = {}) {
  const id = String(args.id ?? "").trim();
  if (!id) {
    return buildCommandResult("object.get", {
      ok: false,
      mode: "runtime",
      error: "object.get requires args.id."
    });
  }
  const object3D = getObjectByThreeJsonId(id);
  if (!object3D) {
    return buildCommandResult("object.get", {
      ok: false,
      mode: "runtime",
      error: `Object not found for threeJsonId "${id}".`
    });
  }
  const descriptor = object3D.userData?.objJson;
  if (!isObjectRecord(descriptor)) {
    return buildCommandResult("object.get", {
      ok: false,
      mode: "runtime",
      error: `Object "${id}" has no descriptor.`
    });
  }
  const path = typeof args.path === "string" ? args.path.trim() : "";
  try {
    const value = path ? getByPath(descriptor, path) : cloneJson(descriptor);
    return buildCommandResult("object.get", {
      ok: true,
      mode: "runtime",
      data: {
        threeJsonId: id,
        path: path || null,
        value
      }
    });
  } catch (err) {
    return buildCommandResult("object.get", {
      ok: false,
      mode: "runtime",
      error: String(err?.message || err)
    });
  }
}

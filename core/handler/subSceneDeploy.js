import { getObjectByThreeJsonId } from "./objectRegistry.js";
import { log } from "../util/logger.js";

/**
 * @param {import("three").Object3D} overlayRoot
 * @param {object} record
 * @param {object} ctx
 * @param {(root: import("three").Object3D, rec: object, c: object) => void|Promise<void>} deployOne
 */
export function deploySubSceneChildren(overlayRoot, record, ctx, deployOne) {
  if (!record || typeof record !== "object") {
    return;
  }
  const children = Array.isArray(record.subScene) ? record.subScene : [];
  if (children.length === 0) {
    return;
  }
  const id = typeof record.threeJsonId === "string" ? record.threeJsonId.trim() : "";
  let parent = id ? getObjectByThreeJsonId(id) : null;
  if (!parent) {
    const policy = ctx?.subSceneNormalizePolicy === "strict" ? "strict" : "warn";
    const msg = `subScene parent object not found for threeJsonId "${id}" — attaching children to deploy root`;
    if (policy === "strict") {
      throw new Error(msg);
    }
    if (typeof ctx?.onWarning === "function") {
      ctx.onWarning(msg);
    } else {
      log.warn(`[subScene] ${msg}`);
    }
    parent = overlayRoot;
  }
  const pending = [];
  for (let i = 0; i < children.length; i++) {
    const result = deployOne(parent, children[i], ctx);
    if (result && typeof result.then === "function") {
      pending.push(result);
    }
  }
  return pending.length > 0 ? Promise.all(pending).then(() => undefined) : undefined;
}

/**
 * @param {import("three").Object3D} overlayRoot
 * @param {object} record
 * @param {object} ctx
 * @param {(root: import("three").Object3D, rec: object, c: object) => Promise<void>} deployOneAsync
 * @returns {Promise<void>}
 */
export async function deploySubSceneChildrenAsync(overlayRoot, record, ctx, deployOneAsync) {
  if (!record || typeof record !== "object") {
    return;
  }
  const children = Array.isArray(record.subScene) ? record.subScene : [];
  if (children.length === 0) {
    return;
  }
  const id = typeof record.threeJsonId === "string" ? record.threeJsonId.trim() : "";
  let parent = id ? getObjectByThreeJsonId(id) : null;
  if (!parent) {
    const policy = ctx?.subSceneNormalizePolicy === "strict" ? "strict" : "warn";
    const msg = `subScene parent object not found for threeJsonId "${id}" — attaching children to deploy root`;
    if (policy === "strict") {
      throw new Error(msg);
    }
    if (typeof ctx?.onWarning === "function") {
      ctx.onWarning(msg);
    } else {
      log.warn(`[subScene] ${msg}`);
    }
    parent = overlayRoot;
  }
  for (let i = 0; i < children.length; i++) {
    await deployOneAsync(parent, children[i], ctx);
  }
}

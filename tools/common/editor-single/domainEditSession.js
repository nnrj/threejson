/**
 * Domain 编辑会话：drill-in、子编辑检测、退化/撤销/绑定与设置读取。
 *
 * - `bound`：用户已绑定 domain/handler；快照优先 capture 合并，否则 persistSource + 根变换（不阻断整场景导出）。
 * - `undo`：仅恢复 `persistSource` 与 drill-in 基线变换，不 redeploy 工厂拓扑（见 Phase D）。
 */
import * as THREE from "three";

import { getDomain, isKnownDomainHandler } from "../../../core/handler/businessDomainRegistry.js";
import {
  collectDomainExportCaveats,
  DOMAIN_EDIT_STATES,
  domainChildTransformsChanged,
  getDomainEditState,
  getPersistSource,
  isDomainDeployRootObject,
  resolveDomainDeployRootAncestor,
  setDomainChildTransformBaseline,
  setDomainEditState,
  setPersistSource,
  snapshotDomainChildTransforms
} from "../../../core/handler/domainDeployDescriptor.js";
import { setUserDataObjJson } from "../../../core/handler/objectDescriptorAttach.js";
import { snapshotBoxModelTransformFromObject3D } from "../../../core/builder/modelBuilder.js";
import { exportWysiwygDeployRootFromObject3D } from "../../../core/util/sceneToJson.js";
import { cloneJson } from "../../../core/util/cloneJson.js";

const DEFAULT_DOMAIN_EDIT_SETTINGS = Object.freeze({
  promptOnChildChange: true,
  silentDefaultAction: "degrade",
  enableChildMutationOverlay: false
});

/**
 * @param {object|null|undefined} editorSettings
 */
export function resolveDomainEditSettings(editorSettings) {
  const raw = editorSettings?.domainEdit;
  const silent = String(raw?.silentDefaultAction || DEFAULT_DOMAIN_EDIT_SETTINGS.silentDefaultAction).trim();
  const allowed = new Set(["degrade", "bind", "undo"]);
  return {
    promptOnChildChange: raw?.promptOnChildChange !== false,
    silentDefaultAction: allowed.has(silent) ? silent : "degrade",
    enableChildMutationOverlay: raw?.enableChildMutationOverlay === true
  };
}

export { isDomainDeployRootObject, getDomainEditState, DOMAIN_EDIT_STATES };

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @param {import("three").Scene|null|undefined} scene
 */
export function resolveDomainDeployRoot(object3D, scene) {
  return resolveDomainDeployRootAncestor(object3D, scene);
}

/**
 * @param {import("three").Scene} scene
 */
export function listDomainDeployRootsOnScene(scene) {
  const out = [];
  const children = scene?.children;
  if (!children?.length) {
    return out;
  }
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child && isDomainDeployRootObject(child)) {
      out.push(child);
    }
  }
  return out;
}

export {
  collectDomainExportCaveats,
  domainChildTransformsChanged,
  snapshotDomainChildTransforms
};

/**
 * @param {import("three").Object3D} root
 * @param {object} baseline
 */
export function restoreDomainChildTransforms(root, baseline) {
  if (!root?.traverse || !baseline) {
    return;
  }
  root.traverse((obj) => {
    if (obj === root) {
      return;
    }
    const id = obj.userData?.objJson?.threeJsonId || obj.uuid;
    const snap = baseline[id];
    if (!snap) {
      return;
    }
    if (snap.position) {
      obj.position.set(
        Number(snap.position.x || 0),
        Number(snap.position.y || 0),
        Number(snap.position.z || 0)
      );
    }
    if (snap.rotation) {
      obj.rotation.set(
        Number(snap.rotation.rotationX ?? snap.rotation.x ?? 0),
        Number(snap.rotation.rotationY ?? snap.rotation.y ?? 0),
        Number(snap.rotation.rotationZ ?? snap.rotation.z ?? 0)
      );
    }
    if (snap.scale) {
      obj.scale.set(
        Number(snap.scale.scaleX ?? snap.scale.x ?? 1),
        Number(snap.scale.scaleY ?? snap.scale.y ?? 1),
        Number(snap.scale.scaleZ ?? snap.scale.z ?? 1)
      );
    }
  });
}

/**
 * @param {import("three").Object3D} root
 * @param {object} [options]
 */
export function degradeDomainRootToGroup(root, options = {}) {
  const record = exportWysiwygDeployRootFromObject3D(root, options);
  if (!record) {
    return null;
  }
  setUserDataObjJson(root, record);
  setDomainEditState(root, DOMAIN_EDIT_STATES.DEGRADED);
  if (root.userData && typeof root.userData === "object") {
    delete root.userData.persistSource;
  }
  return record;
}

/**
 * @param {import("three").Object3D} root
 */
export function undoDomainChildEditFromPersistSource(root) {
  const src = getPersistSource(root);
  if (!src) {
    return false;
  }
  const t = snapshotBoxModelTransformFromObject3D(root);
  setUserDataObjJson(root, cloneJson(src));
  if (t && root.userData?.objJson && typeof root.userData.objJson === "object") {
    const live = root.userData.objJson;
    if (Array.isArray(live.items) && live.items[0] && typeof live.items[0] === "object") {
      live.items[0].position = t.position;
      live.items[0].rotation = t.rotation;
      live.items[0].scale = t.scale;
    } else {
      live.position = t.position;
      live.rotation = t.rotation;
      live.scale = t.scale;
    }
  }
  setDomainEditState(root, DOMAIN_EDIT_STATES.PRISTINE);
  return true;
}

/**
 * @param {import("three").Object3D} root
 * @param {{ domain?: string, handler?: string, childBaseline?: Record<string, object>|null }} binding
 */
export function bindDomainParserOnRoot(root, binding = {}) {
  const shell = root.userData?.objJson;
  const domainId = String(binding.domain || shell?.domain || "").trim();
  const handler = String(binding.handler || shell?.handler || "").trim();
  if (!domainId || !handler) {
    return { ok: false, error: "domain 与 handler 均不能为空。" };
  }
  const domain = getDomain(domainId);
  if (!domain) {
    return { ok: false, error: `未注册的 domain：${domainId}` };
  }
  if (!isKnownDomainHandler(domain, handler)) {
    return { ok: false, error: `未注册的 handler：${domainId}/${handler}` };
  }
  if (shell && typeof shell === "object") {
    shell.domain = domainId;
    shell.handler = handler;
    shell.objType = "domain";
    setUserDataObjJson(root, shell);
  }
  const persist = getPersistSource(root);
  if (persist) {
    persist.domain = domainId;
    persist.handler = handler;
    setPersistSource(root, persist);
  }
  const baseline = binding.childBaseline && typeof binding.childBaseline === "object"
    ? binding.childBaseline
    : snapshotDomainChildTransforms(root);
  setDomainChildTransformBaseline(root, baseline);
  setDomainEditState(root, DOMAIN_EDIT_STATES.BOUND);
  return { ok: true };
}

/**
 * @param {string} action
 * @param {import("three").Object3D} root
 * @param {object} [ctx]
 */
export function applyDomainChildEditResolution(action, root, ctx = {}) {
  const act = String(action || "").trim();
  if (act === "degrade") {
    const record = degradeDomainRootToGroup(root, ctx.exportOptions);
    return record ? { ok: true, degraded: true } : { ok: false, error: "退化为 group 失败。" };
  }
  if (act === "undo") {
    restoreDomainChildTransforms(root, ctx.childBaseline);
    const ok = undoDomainChildEditFromPersistSource(root);
    return ok ? { ok: true } : { ok: false, error: "无法从加载原文恢复。" };
  }
  if (act === "bind") {
    const bindResult = bindDomainParserOnRoot(root, {
      ...(ctx.binding || {}),
      childBaseline: ctx.childBaseline
    });
    if (!bindResult.ok) {
      if (ctx.fallbackDegradeOnBindFail !== false) {
        degradeDomainRootToGroup(root, ctx.exportOptions);
        return { ok: true, degraded: true, error: bindResult.error };
      }
      return bindResult;
    }
    return { ok: true };
  }
  return { ok: false, error: `未知操作：${act}` };
}

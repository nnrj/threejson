/**
 * Script-facing object handle — wraps Object3D + objectMutation for EventScript.
 */

import { applyObjectPartial } from "../../objectMutation/index.js";
import { resolveEventTarget } from "../resolveEventTarget.js";

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readPosition(descriptor) {
  const p = descriptor?.position;
  return {
    x: Number(p?.x) || 0,
    y: Number(p?.y) || 0,
    z: Number(p?.z) || 0
  };
}

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @param {object} [ctx]
 * @returns {object|null}
 */
export function createScriptObjectHandle(object3D, ctx = {}) {
  if (!object3D) {
    return null;
  }
  const descriptor = object3D.userData?.objJson;
  const threeJsonId = typeof descriptor?.threeJsonId === "string" ? descriptor.threeJsonId.trim() : "";
  if (!threeJsonId) {
    return null;
  }

  const handle = {
    object3D,
    threeJsonId,
    objType: normalizeObjType(descriptor?.objType || descriptor?.type),
    get visible() {
      return object3D.visible;
    },
    set visible(value) {
      applyObjectPartial(threeJsonId, { visible: Boolean(value) }, ctx.mutationOptions);
      object3D.visible = Boolean(value);
    },
    show() {
      handle.visible = true;
    },
    hide() {
      handle.visible = false;
    },
    moveBy(dx = 0, dy = 0, dz = 0) {
      const pos = readPosition(descriptor);
      const next = {
        x: pos.x + (Number(dx) || 0),
        y: pos.y + (Number(dy) || 0),
        z: pos.z + (Number(dz) || 0)
      };
      applyObjectPartial(threeJsonId, { position: next }, ctx.mutationOptions);
      object3D.position.set(next.x, next.y, next.z);
    },
    setPosition(x = 0, y = 0, z = 0) {
      const next = { x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0 };
      applyObjectPartial(threeJsonId, { position: next }, ctx.mutationOptions);
      object3D.position.set(next.x, next.y, next.z);
    }
  };

  return handle;
}

/**
 * @param {string} token
 * @param {object} [ctx]
 * @returns {object|null}
 */
export function resolveScriptObject(token, ctx = {}) {
  const object = resolveEventTarget(token);
  return createScriptObjectHandle(object, ctx);
}

/**
 * @param {object|null|undefined} handle
 * @param {string} expectedObjType
 * @returns {boolean}
 */
export function assertScriptObjectType(handle, expectedObjType) {
  const expected = normalizeObjType(expectedObjType);
  if (!handle || !expected) {
    return false;
  }
  return normalizeObjType(handle.objType) === expected;
}

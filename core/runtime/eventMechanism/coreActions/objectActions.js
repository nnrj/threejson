import {
  applyObjectChange,
  applyObjectPartial,
  applyObjectPartialAsync
} from "../../objectMutation/index.js";
import { resolveEventTarget } from "../resolveEventTarget.js";
import { registerEventAction } from "./actionRegistry.js";

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  if (!isObjectRecord(value)) {
    return { ...fallback };
  }
  return {
    x: numberOr(value.x, fallback.x),
    y: numberOr(value.y, fallback.y),
    z: numberOr(value.z, fallback.z)
  };
}

function readDescriptorVector(object3D, key, fallback = { x: 0, y: 0, z: 0 }) {
  return readVector(object3D?.userData?.objJson?.[key], fallback);
}

function resolveTargetObject(action, ctx) {
  const target = action?.target ?? "self";
  if (target === "self" || target == null || target === "") {
    return ctx.object ?? null;
  }
  return resolveEventTarget(target);
}

function getTargetId(action, ctx) {
  const object = resolveTargetObject(action, ctx);
  const id = object?.userData?.objJson?.threeJsonId;
  return typeof id === "string" ? id.trim() : "";
}

function assertMutationResult(type, result) {
  if (result?.ok) {
    return result;
  }
  throw new Error(`[eventMechanism] ${type} failed: ${result?.error || "mutation failed"}`);
}

function patchOptions(action, ctx) {
  return {
    ...(ctx.mutationOptions && typeof ctx.mutationOptions === "object" ? ctx.mutationOptions : {}),
    ...(action.options && typeof action.options === "object" ? action.options : {})
  };
}

function partialForVector(key, vector) {
  return { [key]: { x: vector.x, y: vector.y, z: vector.z } };
}

async function patchObject(action, ctx) {
  const id = getTargetId(action, ctx);
  const options = patchOptions(action, ctx);
  if (isObjectRecord(action.partial)) {
    const result =
      options.awaitTextures === true
        ? await applyObjectPartialAsync(id, action.partial, options)
        : applyObjectPartial(id, action.partial, { ...options, awaitTextures: false });
    return assertMutationResult(action.type, result);
  }
  if (typeof action.path === "string" && action.path.trim()) {
    return assertMutationResult(action.type, applyObjectChange(id, action.path, action.value, options));
  }
  throw new Error("[eventMechanism] object.patch requires partial or path");
}

function applyPartial(action, ctx, partial) {
  const id = getTargetId(action, ctx);
  return assertMutationResult(action.type, applyObjectPartial(id, partial, patchOptions(action, ctx)));
}

function resolveVectorFromAction(action, key, fallback = { x: 0, y: 0, z: 0 }) {
  return readVector(action[key] ?? action.value ?? action, fallback);
}

function registerObjectActions() {
  registerEventAction("object.setVisible", (action, ctx) => {
    const visible =
      typeof action.visible === "boolean"
        ? action.visible
        : typeof action.value === "boolean"
          ? action.value
          : true;
    return applyPartial(action, ctx, { visible });
  });

  registerEventAction("object.toggleVisible", (action, ctx) => {
    const object = resolveTargetObject(action, ctx);
    return applyPartial(action, ctx, { visible: !Boolean(object?.visible) });
  });

  registerEventAction("object.moveBy", (action, ctx) => {
    const object = resolveTargetObject(action, ctx);
    const current = readDescriptorVector(object, "position");
    const delta = resolveVectorFromAction(action, "delta");
    return applyPartial(action, ctx, partialForVector("position", {
      x: current.x + delta.x,
      y: current.y + delta.y,
      z: current.z + delta.z
    }));
  });

  registerEventAction("object.setPosition", (action, ctx) => {
    return applyPartial(action, ctx, partialForVector("position", resolveVectorFromAction(action, "position")));
  });

  registerEventAction("object.rotateBy", (action, ctx) => {
    const object = resolveTargetObject(action, ctx);
    const current = readDescriptorVector(object, "rotation");
    const delta = resolveVectorFromAction(action, "delta");
    return applyPartial(action, ctx, partialForVector("rotation", {
      x: current.x + delta.x,
      y: current.y + delta.y,
      z: current.z + delta.z
    }));
  });

  registerEventAction("object.setRotation", (action, ctx) => {
    return applyPartial(action, ctx, partialForVector("rotation", resolveVectorFromAction(action, "rotation")));
  });

  registerEventAction("object.scaleBy", (action, ctx) => {
    const object = resolveTargetObject(action, ctx);
    const current = readDescriptorVector(object, "scale", { x: 1, y: 1, z: 1 });
    const factor = resolveVectorFromAction(action, "factor", { x: 1, y: 1, z: 1 });
    return applyPartial(action, ctx, partialForVector("scale", {
      x: current.x * factor.x,
      y: current.y * factor.y,
      z: current.z * factor.z
    }));
  });

  registerEventAction("object.setScale", (action, ctx) => {
    return applyPartial(action, ctx, partialForVector("scale", resolveVectorFromAction(action, "scale", { x: 1, y: 1, z: 1 })));
  });

  registerEventAction("object.patch", patchObject);
}

registerObjectActions();

export { registerObjectActions };

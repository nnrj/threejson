import * as THREE from "three";
import { registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { applyVisibilityFromDescriptor } from "../util/util.js";
import { resolvePosition, resolveRotation, resolveScale } from "../util/vectorValue.js";

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function levelRecords(level) {
  const value = level?.object ?? level?.objects ?? level?.objectList ?? level?.subScene;
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
  return value && typeof value === "object" ? [value] : [];
}

function applyTransform(object, descriptor) {
  const position = resolvePosition(descriptor.position);
  const rotation = resolveRotation(descriptor.rotation);
  const scale = resolveScale(descriptor.scale);
  object.position.set(position.x, position.y, position.z);
  object.rotation.set(rotation.x, rotation.y, rotation.z);
  object.scale.set(scale.x, scale.y, scale.z);
  applyVisibilityFromDescriptor(object, descriptor);
}

/** Deploy a declarative THREE.LOD while delegating child creation to the active dispatcher. */
export function deployLod(record, parent, ctx = {}, deployChild) {
  if (!record || !parent || typeof deployChild !== "function") return null;
  const levels = Array.isArray(record.levels) ? record.levels : [];
  if (!levels.length) {
    const error = new Error("LOD descriptor requires a non-empty levels array");
    error.code = "E_LOD_LEVELS_REQUIRED";
    throw error;
  }
  const lod = new THREE.LOD();
  lod.name = record.name || "lod";
  lod.autoUpdate = record.autoUpdate !== false;
  setUserDataObjJson(lod, { ...record, objType: "lod" });
  applyTransform(lod, record);
  trackDisposableResource(lod, parent);
  parent.add(lod);

  const pending = [];
  levels.forEach((level, index) => {
    const holder = new THREE.Group();
    holder.name = level?.name || `${lod.name}-level-${index}`;
    // The authoritative serialized children live in descriptor.levels. Prevent
    // generic reverse traversal from also exporting them as a duplicate subScene.
    holder.userData.__threeJsonExportExcluded = true;
    lod.addLevel(holder, Math.max(0, finite(level?.distance, index === 0 ? 0 : index * 100)), Math.max(0, finite(level?.hysteresis, 0)));
    for (const child of levelRecords(level)) {
      const result = deployChild(holder, child, ctx);
      if (result && typeof result.then === "function") pending.push(result);
    }
  });
  const registered = registerObject(lod, record, parent);
  return pending.length ? Promise.all(pending).then(() => registered) : registered;
}

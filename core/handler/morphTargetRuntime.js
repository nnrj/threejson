function morphMeshes(root) {
  const output = [];
  root?.traverse?.((object) => {
    if (Array.isArray(object?.morphTargetInfluences) && object.morphTargetInfluences.length > 0) output.push(object);
  });
  return output;
}

function matchesMesh(object, selector) {
  if (!selector) return true;
  const value = String(selector);
  return object.name === value
    || object.uuid === value
    || object.userData?.objJson?.threeJsonId === value;
}

function targetEntries(object) {
  const dictionary = object.morphTargetDictionary || {};
  const namesByIndex = new Map(Object.entries(dictionary).map(([name, index]) => [Number(index), name]));
  return object.morphTargetInfluences.map((value, index) => ({
    index,
    name: namesByIndex.get(index) ?? String(index),
    value: Number(value) || 0
  }));
}

export function listMorphTargets(root, options = {}) {
  return morphMeshes(root)
    .filter((object) => matchesMesh(object, options.mesh))
    .map((object) => ({
      objectName: object.name || "",
      objectUuid: object.uuid,
      threeJsonId: object.userData?.objJson?.threeJsonId || null,
      targets: targetEntries(object)
    }));
}

function resolveTargetIndex(object, target) {
  if (Number.isInteger(Number(target)) && String(target).trim() !== "") return Number(target);
  if (typeof target === "string" && Object.prototype.hasOwnProperty.call(object.morphTargetDictionary || {}, target)) {
    return object.morphTargetDictionary[target];
  }
  return -1;
}

/** Set one named/indexed morph across matching meshes in a loaded model. */
export function setMorphTargetInfluence(root, target, value, options = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new TypeError("morph influence must be finite");
  const next = options.clamp === false ? numeric : Math.max(0, Math.min(1, numeric));
  const changed = [];
  for (const object of morphMeshes(root)) {
    if (!matchesMesh(object, options.mesh)) continue;
    const index = resolveTargetIndex(object, target);
    if (index < 0 || index >= object.morphTargetInfluences.length) continue;
    object.morphTargetInfluences[index] = next;
    changed.push({ objectName: object.name || "", objectUuid: object.uuid, target, index, value: next });
  }
  if (changed.length > 0 && options.syncDescriptor !== false && root?.userData?.objJson) {
    const descriptor = root.userData.objJson;
    descriptor.morphInfluences = descriptor.morphInfluences && typeof descriptor.morphInfluences === "object"
      ? descriptor.morphInfluences
      : {};
    descriptor.morphInfluences[String(target)] = next;
  }
  return changed;
}

export function applyMorphInfluencesFromDescriptor(root, descriptor = root?.userData?.objJson) {
  const values = descriptor?.morphInfluences ?? descriptor?.morphTargets;
  if (!values) return [];
  const changed = [];
  if (Array.isArray(values)) {
    values.forEach((value, index) => changed.push(...setMorphTargetInfluence(root, index, value, { syncDescriptor: false })));
  } else if (typeof values === "object") {
    Object.entries(values).forEach(([target, value]) => changed.push(...setMorphTargetInfluence(root, target, value, { syncDescriptor: false })));
  }
  return changed;
}

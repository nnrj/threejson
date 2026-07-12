/**
 * Runtime registry and target operations for deployed post-processing passes (no business semantics).
 *
 * State lives inside `createScenePassRegistryStore()` instances, one per RuntimeContext
 * (see core/runtime/runtimeContext.js), so two scenes that happen to reuse the same
 * pass id (e.g. both name a bloom pass "bloom") don't collide, and clearing one scene's
 * pass registry never wipes a concurrently-loading sibling scene's. Named exports take
 * an optional trailing `runtimeScope`; omitting it preserves today's shared-global behavior.
 */
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";

export function createScenePassRegistryStore() {
  /** @type {Map<string, { pass: object, record: object, passType: string }>} */
  const passesById = new Map();

  function registerDeployedPass(passId, pass, record, passType) {
    const key = typeof passId === "string" ? passId.trim() : "";
    if (!key || !pass) {
      return;
    }
    passesById.set(key, {
      pass,
      record: record && typeof record === "object" ? record : {},
      passType: typeof passType === "string" ? passType : ""
    });
  }

  function getDeployedPass(passId) {
    const key = typeof passId === "string" ? passId.trim() : "";
    return key ? passesById.get(key) ?? null : null;
  }

  function setPassTargets(passId, objects) {
    const entry = getDeployedPass(passId);
    if (!entry?.pass?.selectedObjects) {
      return;
    }
    entry.pass.selectedObjects = Array.isArray(objects) ? [...objects] : [];
    syncPassActivity(entry.pass);
  }

  function addPassTargets(passId, objects) {
    const entry = getDeployedPass(passId);
    if (!entry?.pass?.selectedObjects || !Array.isArray(objects)) {
      return;
    }
    const current = entry.pass.selectedObjects;
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      if (obj && !current.includes(obj)) {
        current.push(obj);
      }
    }
    syncPassActivity(entry.pass);
  }

  function removePassTarget(passId, object) {
    const entry = getDeployedPass(passId);
    if (!entry?.pass?.selectedObjects) {
      return;
    }
    const list = entry.pass.selectedObjects;
    const idx = list.indexOf(object);
    if (idx >= 0) {
      list.splice(idx, 1);
    }
    syncPassActivity(entry.pass);
  }

  function clearPassTargets(passId) {
    const entry = getDeployedPass(passId);
    if (!entry?.pass?.selectedObjects) {
      return;
    }
    entry.pass.selectedObjects = [];
    syncPassActivity(entry.pass);
  }

  function clearPassRuntimeRegistry() {
    passesById.clear();
  }

  function listDeployedPassIds() {
    return Array.from(passesById.keys());
  }

  return {
    registerDeployedPass,
    getDeployedPass,
    setPassTargets,
    addPassTargets,
    removePassTarget,
    clearPassTargets,
    clearPassRuntimeRegistry,
    listDeployedPassIds,
    dispose: clearPassRuntimeRegistry
  };
}

/**
 * @param {object} pass
 */
export function syncPassActivity(pass) {
  if (!pass || !pass.selectedObjects) {
    return;
  }
  const n = pass.selectedObjects.length;
  if (typeof pass.enabled === "boolean") {
    pass.enabled = n > 0;
  }
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).scenePassRegistry;
}

export function registerDeployedPass(passId, pass, record, passType, runtimeScope) {
  return resolveStore(runtimeScope).registerDeployedPass(passId, pass, record, passType);
}

export function getDeployedPass(passId, runtimeScope) {
  return resolveStore(runtimeScope).getDeployedPass(passId);
}

export function setPassTargets(passId, objects, runtimeScope) {
  return resolveStore(runtimeScope).setPassTargets(passId, objects);
}

export function addPassTargets(passId, objects, runtimeScope) {
  return resolveStore(runtimeScope).addPassTargets(passId, objects);
}

export function removePassTarget(passId, object, runtimeScope) {
  return resolveStore(runtimeScope).removePassTarget(passId, object);
}

export function clearPassTargets(passId, runtimeScope) {
  return resolveStore(runtimeScope).clearPassTargets(passId);
}

export function clearPassRuntimeRegistry(runtimeScope) {
  return resolveStore(runtimeScope).clearPassRuntimeRegistry();
}

export function listDeployedPassIds(runtimeScope) {
  return resolveStore(runtimeScope).listDeployedPassIds();
}

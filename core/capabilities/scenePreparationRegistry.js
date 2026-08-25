const preparers = new Map();

export function registerSceneCapabilityPreparer(id, prepare) {
  const key = typeof id === "string" ? id.trim() : "";
  if (!key || typeof prepare !== "function") throw new Error("[scenePreparer] id and prepare function are required");
  preparers.set(key, prepare);
}

export function unregisterSceneCapabilityPreparer(id) {
  return preparers.delete(String(id || "").trim());
}

export async function runSceneCapabilityPreparers(payload, options = {}) {
  for (const [id, prepare] of preparers) {
    await prepare(payload, { ...options, preparerId: id });
  }
}

export function _clearSceneCapabilityPreparersForTests() {
  preparers.clear();
}


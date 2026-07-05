/**
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeDeclaredRevision(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    const match = /^r?(\d+)$/.exec(trimmed);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

/**
 * @param {typeof import("three")|undefined|null} THREE
 * @returns {number|null}
 */
export function parseRevisionFromThree(THREE) {
  if (!THREE) {
    return null;
  }
  const raw = THREE.REVISION ?? THREE.revision;
  const n = typeof raw === "string" ? parseInt(raw, 10) : raw;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * @param {{ three?: typeof import("three"), sceneJsonRoot?: object, sceneConfig?: object, worldInfo?: object }} [options]
 * @returns {number}
 */
export function readDeclaredRevisionFromContext(options = {}) {
  const sceneConfig = options.sceneConfig
    ?? options.sceneJsonRoot?.sceneConfig
    ?? options.worldInfo?.sceneConfig;
  const worldInfo = options.worldInfo ?? options.sceneJsonRoot?.worldInfo;
  const fromScene = normalizeDeclaredRevision(sceneConfig?.threeRevision);
  if (fromScene != null) {
    return fromScene;
  }
  return normalizeDeclaredRevision(worldInfo?.threeRevision) ?? null;
}

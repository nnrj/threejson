/**
 * Disposable resource tracking bucket (zero handler/builder deps to avoid resourceReclaimer cycles).
 * builder / util import track only from here; dispose orchestration is in resourceReclaimer.js.
 *
 * Deliberately kept as a single process-wide bucket (not per-RuntimeContext): most call
 * sites only have a bare resource (geometry/material/loader) at module-eval time with no
 * scene reference available to scope by, and several call `trackDisposableResource` at
 * module top level (e.g. shared TextureLoader singletons), which would race against
 * core/runtime/runtimeContext.js's own circular-import initialization if wired in here.
 * The actual multi-canvas hazard this bucket posed — disposing a whole shared bucket
 * when tearing down one scene, which could destroy a concurrently-mounted sibling
 * scene's still-in-use resources — is fixed at the call site instead: see
 * `disposeTrackedSceneResources` in resourceReclaimer.js, which now disposes only the
 * target scene's own Object3D subtree rather than clearing this shared bucket.
 */

let trackedResourceBucket = null;

function getTrackedResourceBucket() {
  if (!trackedResourceBucket) {
    trackedResourceBucket = new Set();
  }
  return trackedResourceBucket;
}

/**
 * @param {*} resource
 * @returns {*}
 */
export function trackDisposableResource(resource) {
  if (!resource) {
    return resource;
  }
  if (Array.isArray(resource)) {
    for (let i = 0; i < resource.length; i += 1) {
      trackDisposableResource(resource[i]);
    }
    return resource;
  }
  getTrackedResourceBucket().add(resource);
  return resource;
}

/**
 * @param {*} resource
 */
export function untrackDisposableResource(resource) {
  if (!resource) {
    return;
  }
  if (Array.isArray(resource)) {
    for (let i = 0; i < resource.length; i += 1) {
      untrackDisposableResource(resource[i]);
    }
    return;
  }
  getTrackedResourceBucket().delete(resource);
}

/** @returns {Set<*>} */
export function getTrackedResourceBucketForDispose() {
  return getTrackedResourceBucket();
}

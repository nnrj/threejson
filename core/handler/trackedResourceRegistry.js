/**
 * Disposable resource tracking bucket (zero handler/builder deps to avoid resourceReclaimer cycles).
 * builder / util import track only from here; dispose orchestration is in resourceReclaimer.js.
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

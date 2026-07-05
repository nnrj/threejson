import * as THREE from "three";
import { log } from "../util/logger.js";

import { disposeObjectTree, detachObjectTree, disposeMaterialResource } from "./disposeObjectTree.js";
import { getObjectByThreeJsonId } from "./objectRegistry.js";
import { removeObjectByThreeJsonIdCore } from "./objectDeleteById.js";
import { getThreeJsonIdsInSystemBucket } from "./bucketIndex.js";
import { disposeThreeJsonSceneBackdrop } from "./sceneBackdropResolver.js";
import { cleanupThreeJsonAudioAttachments } from "../builder/audioBuilder.js";
import {
  trackDisposableResource,
  untrackDisposableResource,
  getTrackedResourceBucketForDispose
} from "./trackedResourceRegistry.js";

const DEFAULT_CONTENT_SYSTEM_TAGS = Object.freeze([
  "objects",
  "domain",
  "models",
  "native-record",
  "native-scene",
  "temp",
  "environment",
  "assist"
]);

function disposeTrackedOne(resource, state) {
  if (!resource || state.visited.has(resource)) {
    return;
  }
  state.visited.add(resource);

  if (resource?.isObject3D === true) {
    disposeObjectTree(resource);
    return;
  }

  if (resource instanceof THREE.Material) {
    disposeMaterialResource(resource, state);
    return;
  }

  if (resource instanceof THREE.Texture) {
    resource.dispose?.();
    return;
  }

  if (typeof resource.dispose === "function") {
    resource.dispose();
  }
  if (typeof resource.clear === "function") {
    resource.clear();
  }
}

function disposeTrackedResources() {
  const state = { visited: new Set() };
  const bucket = getTrackedResourceBucketForDispose();
  for (const resource of bucket) {
    try {
      disposeTrackedOne(resource, state);
    } catch (error) {
      log.warn("[resourceReclaimer] dispose tracked resource skipped:", error);
    }
  }
  bucket.clear();
}

function trackSceneResources(scene) {
  if (!scene || typeof scene.traverse !== "function") {
    return scene;
  }
  scene.traverse((obj) => {
    trackDisposableResource(obj);
  });
  return scene;
}

function disposeTrackedSceneResources(scene) {
  trackSceneResources(scene);
  disposeTrackedResources();
}

function mapCoreDeleteResult(core) {
  const result = {
    ok: core.ok,
    error: core.error || null,
    threeJsonId: core.threeJsonId || "",
    object3D: core.object3D ?? null,
    needsAsync: false
  };
  if (core.protected) {
    result.protected = true;
  }
  if (core.removedDescriptor !== undefined) {
    result.removedDescriptor = core.removedDescriptor;
  }
  if (core.removedParentThreeJsonId !== undefined) {
    result.removedParentThreeJsonId = core.removedParentThreeJsonId;
  }
  if (core.removedSubtree) {
    result.removedSubtree = core.removedSubtree;
  }
  return result;
}

function disposeByThreeJsonId(scene, threeJsonId, options = {}) {
  return mapCoreDeleteResult(removeObjectByThreeJsonIdCore(scene, threeJsonId, options));
}

function detachByThreeJsonId(scene, threeJsonId, options = {}) {
  return mapCoreDeleteResult(removeObjectByThreeJsonIdCore(scene, threeJsonId, {
    ...options,
    disposeResources: false,
    detachOnly: true
  }));
}

function disposeSceneContent(scene, options = {}) {
  if (!scene?.isScene) {
    return;
  }
  const tags = Array.isArray(options.systemTags) && options.systemTags.length > 0
    ? options.systemTags
    : DEFAULT_CONTENT_SYSTEM_TAGS;
  const seen = new Set();
  for (let ti = 0; ti < tags.length; ti += 1) {
    const ids = getThreeJsonIdsInSystemBucket(tags[ti]);
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const object3D = getObjectByThreeJsonId(id);
      if (object3D) {
        disposeObjectTree(object3D);
      }
    }
  }
}

function disposeRuntimeResources(runtime, options = {}) {
  const scene = runtime?.scene?.isScene ? runtime.scene : null;
  if (!scene) {
    return;
  }
  if (runtime?.camera) {
    cleanupThreeJsonAudioAttachments(runtime.camera);
  }
  if (options.disposeSceneContent !== false) {
    disposeSceneContent(scene, options);
  }
  const children = Array.isArray(scene.children) ? [...scene.children] : [];
  for (let i = 0; i < children.length; i += 1) {
    disposeObjectTree(children[i]);
  }
  disposeThreeJsonSceneBackdrop(scene);
}

export {
  trackDisposableResource,
  untrackDisposableResource,
  disposeTrackedResources,
  disposeByThreeJsonId,
  detachByThreeJsonId,
  disposeSceneContent,
  disposeRuntimeResources,
  trackSceneResources,
  disposeTrackedSceneResources,
  disposeObjectTree,
  detachObjectTree
};

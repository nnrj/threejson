import { log } from "../util/logger.js";
import { createBucketIndexStore } from "../handler/bucketIndex.js";
import { createObjTypeIndexStore } from "../handler/objTypeIndex.js";
import { createDomainIndexStore } from "../handler/domainIndex.js";
import { createObjectRegistryStore } from "../handler/objectRegistry.js";
import { createDescriptorSyncStore } from "../handler/descriptorSync.js";
import { createDescriptorBindingStore } from "../handler/sceneDescriptorBinding.js";
import { createDeploySchedulerStore } from "./deployScheduler.js";
import { createEventBindingRegistryStore } from "./eventMechanism/eventBindingRegistry.js";
import { createEventManagerSlotStore } from "./eventMechanism/bindEventRuntime.js";
import { createAssetRegistryStore } from "../cache/assetRegistry.js";
import { createTextureUrlCacheStore } from "../cache/textureUrlCache.js";
import { createTextureSamplingStore } from "../util/textureSampling.js";
import { createInfoPanelDeployStore } from "../builder/infoPanelBuilder.js";
import { createAudioSessionStore } from "../builder/audioBuilder.js";
import { createPointsMotionStore } from "../builder/pointsMotion.js";
import { createParticleGpuComputeStore } from "../builder/particle/particleGpuCompute.js";
import { createPlaneScrollMotionStore } from "../builder/planeScrollMotion.js";
import { createShaderMotionStore } from "../builder/shader/shaderMotion.js";
import { createTweenGroupStore } from "../compat/adapters/tween.js";
import { createAnimationMixerStore } from "../handler/animationMixerRegistry.js";
import { createAnimationStateMachineStore } from "../handler/animationStateMachine.js";
import { createScenePassRegistryStore } from "../util/scenePassRuntime.js";

/**
 * THREE-revision/sceneConfig compat context for the in-progress deploy (see
 * core/handler/sceneLoadHandler.js's setSceneLoadCompatContext), so concurrently-loading
 * scenes don't read each other's compat context while mounting lights. Defined inline
 * (no import) since sceneLoadHandler.js has a large dependency tree that must not be
 * pulled into this module's own circular-import-sensitive evaluation.
 */
function createCompatContextStore() {
  /** @type {object|undefined} */
  let activeSceneLoadContext;
  return {
    get() {
      return activeSceneLoadContext;
    },
    set(ctx) {
      activeSceneLoadContext = ctx;
    },
    dispose() {
      activeSceneLoadContext = undefined;
    }
  };
}

/**
 * Per-scene runtime state container: object identity indices, deploy scheduler,
 * event mechanism, asset/texture caches, animation registries, etc. all live here
 * instead of module-level singletons, so multiple concurrently-mounted scenes
 * (multi-canvas pages) don't clobber each other.
 *
 * Resolution is keyed by THREE.Scene object identity (WeakMap), not by any
 * user-supplied id/namespace: whoever holds the scene/runtime handle returned by
 * createJsonScene already holds the isolation boundary. Code that never attaches
 * a context (legacy call sites, tests, single-canvas apps) transparently falls
 * back to one lazily-created default context, preserving today's behavior.
 */

/** @type {WeakMap<object, RuntimeContext>} */
const contextByScene = new WeakMap();

/** @type {RuntimeContext|null} */
let defaultContext = null;

/**
 * The most recently `attachRuntimeContext`-bound context (i.e. the most recently
 * created scene). This is the key to preserving "行为可预测" (design-principles.md):
 * single-canvas callers that never pass a runtimeScope (the overwhelming majority of
 * existing demos/editor/player code) must keep resolving to *the* scene, exactly like
 * the pre-refactor flat global registries did — not to a permanently empty, disconnected
 * store. Multi-canvas-aware code that cares which scene should still pass an explicit
 * scope (scene/ctx), which always takes priority over this fallback.
 * @type {RuntimeContext|null}
 */
let lastAttachedContext = null;

/**
 * Fixed dispose order: event mechanism -> animation registries -> deploy scheduler
 * -> asset/texture caches -> tracked resources -> remaining indices. Each phase of
 * the multi-canvas migration adds its store under one of these keys; unpopulated
 * keys are simply skipped.
 * @type {string[]}
 */
const DISPOSE_ORDER = [
  "eventManagerSlot",
  "eventBindingRegistry",
  "animationMixer",
  "animationStateMachine",
  "pointsMotion",
  "particleGpuCompute",
  "planeScrollMotion",
  "shaderMotion",
  "tweenGroup",
  "deployScheduler",
  "assetRegistry",
  "textureUrlCache",
  "textureSampling",
  "audioSession",
  "infoPanelDeploy",
  "loading",
  "objectRegistry",
  "bucketIndex",
  "objTypeIndex",
  "domainIndex",
  "descriptorSync",
  "descriptorBinding",
  "scenePassRegistry",
  "compat"
];

/**
 * @typedef {object} RuntimeContext
 * @property {true} __isThreeJsonRuntimeContext
 * @property {(store: object) => void} dispose
 */

/**
 * @returns {RuntimeContext}
 */
function createRuntimeContext() {
  /** @type {RuntimeContext} */
  const ctx = {
    __isThreeJsonRuntimeContext: true,
    dispose() {
      for (let i = 0; i < DISPOSE_ORDER.length; i++) {
        const key = DISPOSE_ORDER[i];
        const store = ctx[key];
        if (!store) {
          continue;
        }
        try {
          if (typeof store.dispose === "function") {
            store.dispose();
          } else if (typeof store.clear === "function") {
            store.clear();
          }
        } catch (err) {
          log.warn(`[runtimeContext] dispose failed for "${key}":`, err);
        }
      }
      if (lastAttachedContext === ctx) {
        lastAttachedContext = null;
      }
      if (defaultContext === ctx) {
        defaultContext = null;
      }
    }
  };

  ctx.bucketIndex = createBucketIndexStore();
  ctx.objTypeIndex = createObjTypeIndexStore();
  ctx.domainIndex = createDomainIndexStore();
  ctx.objectRegistry = createObjectRegistryStore({
    bucketIndexStore: ctx.bucketIndex,
    objTypeIndexStore: ctx.objTypeIndex,
    domainIndexStore: ctx.domainIndex,
    ownerRuntimeContext: ctx
  });
  ctx.descriptorSync = createDescriptorSyncStore();
  ctx.descriptorBinding = createDescriptorBindingStore();
  ctx.deployScheduler = createDeploySchedulerStore();
  ctx.eventBindingRegistry = createEventBindingRegistryStore();
  ctx.eventManagerSlot = createEventManagerSlotStore();
  ctx.assetRegistry = createAssetRegistryStore();
  ctx.textureUrlCache = createTextureUrlCacheStore();
  ctx.textureSampling = createTextureSamplingStore();
  ctx.infoPanelDeploy = createInfoPanelDeployStore();
  ctx.audioSession = createAudioSessionStore();
  ctx.pointsMotion = createPointsMotionStore();
  ctx.particleGpuCompute = createParticleGpuComputeStore();
  ctx.planeScrollMotion = createPlaneScrollMotionStore();
  ctx.shaderMotion = createShaderMotionStore();
  ctx.tweenGroup = createTweenGroupStore();
  ctx.animationStateMachine = createAnimationStateMachineStore({ ownerRuntimeContext: ctx });
  ctx.animationMixer = createAnimationMixerStore();
  ctx.scenePassRegistry = createScenePassRegistryStore();
  ctx.compat = createCompatContextStore();

  return ctx;
}

/**
 * @returns {RuntimeContext}
 */
function getOrCreateDefaultRuntimeContext() {
  if (!defaultContext) {
    defaultContext = createRuntimeContext();
  }
  return defaultContext;
}

/**
 * Bind a RuntimeContext to a Scene (or any other Object3D) by identity. Used both
 * for the Scene root (createJsonScene) and for individual registered objects, so
 * lookups still resolve correctly even after an object is detached from its parent
 * (e.g. during unregister-after-remove sequences).
 * @param {import("three").Object3D|null|undefined} sceneOrObject
 * @param {RuntimeContext} ctx
 * @returns {RuntimeContext}
 */
function attachRuntimeContext(sceneOrObject, ctx) {
  if (!sceneOrObject || !ctx) {
    return ctx;
  }
  contextByScene.set(sceneOrObject, ctx);
  if (sceneOrObject.isScene === true) {
    lastAttachedContext = ctx;
  }
  return ctx;
}

/**
 * @param {import("three").Object3D|null|undefined} sceneOrObject
 */
function detachRuntimeContext(sceneOrObject) {
  if (!sceneOrObject) {
    return;
  }
  contextByScene.delete(sceneOrObject);
}

function isRuntimeContext(value) {
  return Boolean(value && value.__isThreeJsonRuntimeContext === true);
}

/**
 * Resolve the RuntimeContext for a Scene / Object3D / runtime handle / lifecycle
 * ctx bag / CommandContext / RuntimeContext itself.
 *
 * When nothing is passed (or nothing resolves), falls back to `lastAttachedContext`
 * (the most recently `createJsonScene`-created scene) rather than a permanently empty
 * store — this is what keeps single-canvas callers that never pass a scope (the
 * overwhelming majority of existing demos/editor/player code, which call e.g.
 * `getObjectByThreeJsonId(id)` with no second argument) working exactly like the
 * pre-refactor flat-global registries. Code that never creates a scene via
 * createJsonScene at all (e.g. bare `createSceneRuntime` + manual `deployMesh`) still
 * gets one shared lazily-created default context, matching today's behavior too.
 * @param {*} [sceneOrObjectOrCtx]
 * @returns {RuntimeContext}
 */
function resolveRuntimeContext(sceneOrObjectOrCtx) {
  if (!sceneOrObjectOrCtx) {
    return lastAttachedContext ?? getOrCreateDefaultRuntimeContext();
  }
  if (isRuntimeContext(sceneOrObjectOrCtx)) {
    return sceneOrObjectOrCtx;
  }
  if (isRuntimeContext(sceneOrObjectOrCtx.runtimeContext)) {
    return sceneOrObjectOrCtx.runtimeContext;
  }
  const candidateRoot =
    sceneOrObjectOrCtx.isScene || sceneOrObjectOrCtx.isObject3D
      ? sceneOrObjectOrCtx
      : (sceneOrObjectOrCtx.scene ?? null);
  let node = candidateRoot;
  while (node) {
    const found = contextByScene.get(node);
    if (found) {
      return found;
    }
    node = node.parent ?? null;
  }
  return lastAttachedContext ?? getOrCreateDefaultRuntimeContext();
}

/** @internal test-only: force-reset the default context */
function _resetDefaultRuntimeContextForTests() {
  defaultContext = null;
}

export {
  createRuntimeContext,
  getOrCreateDefaultRuntimeContext,
  attachRuntimeContext,
  detachRuntimeContext,
  resolveRuntimeContext,
  isRuntimeContext,
  _resetDefaultRuntimeContextForTests
};

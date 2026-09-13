import { LoadingManager } from "three";
import { resolveRuntimeContext, runWithRuntimeContextScope } from "../runtime/runtimeContext.js";
import { resolvePublicAssetUrlCandidates } from "../util/assetsBase.js";
import { disposeObjectTree } from "../handler/disposeObjectTree.js";

/** One external model acquisition, with an immutable resolver and independent cancellation. */
export function createModelLoadScope(scene, options = {}, fallbackManager) {
  const context = resolveRuntimeContext(scene);
  const upstream = options.loadingManager || fallbackManager;
  const resolveResource = context.resolveModelResourceUrl;
  const policy = context.assetUrlPolicy;
  const manager = new LoadingManager();
  const controller = new AbortController();
  const signals = [...new Set([context.signal, context.loadSignal, options.signal].filter(Boolean))];
  const objects = new Set(), temporary = new Set(), waiters = new Set();
  let pending = 0;
  const run = (callback) => runWithRuntimeContextScope(context, callback);
  const check = () => controller.signal.throwIfAborted();
  const disposeOwned = () => run(() => {
    for (const object of objects) disposeObjectTree(object);
    objects.clear();
  });
  const abort = (event) => {
    if (controller.signal.aborted) return;
    controller.abort(event?.target?.reason || new DOMException("Model loading cancelled.", "AbortError"));
    manager.abort?.();
    for (const waiter of waiters) waiter.reject(controller.signal.reason);
    waiters.clear();
    disposeOwned();
  };
  for (const signal of signals) {
    if (signal.aborted) abort({ target: signal });
    else signal.addEventListener("abort", abort, { once: true });
  }
  manager.setURLModifier((url) => {
    check();
    const resolved = upstream?.resolveURL?.(url) ?? url;
    const next = resolveResource?.(resolved) ?? resolved;
    if (typeof next !== "string") throw new TypeError("Model URL resolvers must return a synchronous URL string.");
    return next;
  });
  const getHandler = manager.getHandler.bind(manager);
  manager.getHandler = (url) => getHandler(url) || upstream?.getHandler?.(url) || null;
  const start = manager.itemStart.bind(manager), end = manager.itemEnd.bind(manager), error = manager.itemError.bind(manager);
  const report = (method, url) => { try { upstream?.[method]?.(url); } catch { /* observers cannot break acquisition accounting */ } };
  manager.itemStart = (url) => { pending++; start(url); report("itemStart", url); };
  manager.itemEnd = (url) => {
    pending = Math.max(0, pending - 1); end(url); report("itemEnd", url);
    if (!pending) queueMicrotask(() => {
      if (pending) return;
      for (const waiter of waiters) waiter.resolve();
      waiters.clear();
    });
  };
  manager.itemError = (url) => { error(url); report("itemError", url); };
  return {
    context, manager, signal: controller.signal, run, check,
    resolvePath(source, base = "") {
      const resolved = resolvePublicAssetUrlCandidates(source, policy)[0] || source;
      // /assets is a scene-library alias, not a path relative to the OBJ/GLTF.
      // Its configured base may itself be page-relative (e.g. the legacy demos' "assets").
      const pageBase = options.resourceBaseUrl || globalThis.location?.href;
      const parent = String(source).trim().startsWith("/assets/") ? pageBase : base || pageBase;
      try { return new URL(resolved, parent).href; }
      catch { return resolved; }
    },
    own(object) {
      if (!object) return object;
      if (controller.signal.aborted) { run(() => disposeObjectTree(object)); check(); }
      objects.add(object); return object;
    },
    temporary(resource) { if (resource) temporary.add(resource); return resource; },
    async settled() {
      check();
      if (pending) await new Promise((resolve, reject) => waiters.add({ resolve, reject }));
      check();
    },
    release(object) { objects.delete(object); return object; },
    close() {
      for (const signal of signals) signal.removeEventListener("abort", abort);
      disposeOwned();
      for (const resource of temporary) resource.dispose?.();
      temporary.clear();
    }
  };
}

/** TextureLoader can leave an empty map on MTL/FBX materials after an image error.
 * Call after the acquisition manager settles; retain the actual base material. */
export function discardUndecodedModelTextures(root) {
  const removed = new Set();
  root?.traverse?.((object) => {
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      for (const [slot, texture] of Object.entries(material)) {
        if (!texture?.isTexture || texture.isRenderTargetTexture || texture.isVideoTexture) continue;
        const images = Array.isArray(texture.image) ? texture.image : [texture.image];
        if (images.every((image) => image && Number(image.width || image.videoWidth) > 0 && Number(image.height || image.videoHeight) > 0)) continue;
        material[slot] = null; material.needsUpdate = true;
        removed.add(texture);
      }
    }
  });
  for (const texture of removed) texture.dispose();
  return removed.size;
}

export async function withModelLoadScope(scene, options, fallbackManager, callback) {
  const scope = createModelLoadScope(scene, options, fallbackManager);
  let listener;
  const cancellation = new Promise((_, reject) => {
    listener = () => reject(scope.signal.reason);
    scope.signal.addEventListener("abort", listener, { once: true });
    if (scope.signal.aborted) listener();
  });
  const operation = Promise.resolve().then(() => { scope.check(); return callback(scope); });
  // Keep the ownership guard alive for loaders which cannot cancel image decoding.
  const completion = operation.finally(() => { scope.signal.removeEventListener("abort", listener); scope.close(); });
  return Promise.race([completion, cancellation]);
}

import * as THREE from "three";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";
import { resolvePublicAssetUrlCandidates } from "../util/assetsBase.js";

const requests = new WeakMap();

export function whenTextureReady(texture) {
  return requests.get(texture)?.promise || Promise.resolve(texture);
}

export function getTextureLoadState(texture) {
  return requests.get(texture)?.state || "ready";
}

export function isManagedTexture(texture) { return requests.has(texture); }

/** A synchronous texture handle, with explicit asynchronous readiness and lease ownership. */
export function requestTexture(source, options = {}) {
  const scope = resolveRuntimeContext(options.runtimeScope);
  const resolver = options.assetResolver || scope.assetResolver;
  const target = new THREE.Texture();
  const state = { state: "loading", promise: null };
  requests.set(target, state);
  const loader = options.loader || new THREE.TextureLoader();
  // Capture URL policy now; a subsequently loaded scene must not change it.
  const sourceCandidates = options.candidates || scope.resolveAssetCandidates?.(source) || resolvePublicAssetUrlCandidates(source);
  const lease = resolver.acquire({ source, kind: "texture", replicas: options.replicas }, {
    signal: options.signal,
    resolve: async (request, context) => {
      const candidates = [...new Set([...(request.replicas || []), ...sourceCandidates])];
      const resolve = options.resolveRuntimeUrl || scope.resolveAssetUrl;
      // Cache/proxy resolution can perform IO. Do not fetch unused fallback candidates.
      return resolve ? candidates.map((url) => () => resolve(url, { ...context, kind: "texture", source })) : candidates;
    },
    load: (url, { signal }) => new Promise((resolve, reject) => {
      let finished = false;
      const abort = () => { if (!finished) { finished = true; reject(signal.reason || new DOMException("Aborted", "AbortError")); } };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      let pending;
      pending = loader.load(url, (texture) => {
        signal.removeEventListener("abort", abort);
        if (finished) { texture.dispose?.(); return; }
        finished = true;
        texture.userData.threeJsonResolvedUrl = url;
        resolve(texture);
      }, undefined, (error) => {
        signal.removeEventListener("abort", abort);
        if (finished) return;
        finished = true;
        pending?.dispose?.();
        reject(error instanceof Error ? error : new Error(`Texture load failed: ${source}`));
      });
    }),
    dispose: (texture) => texture.dispose?.()
  });
  let released = false;
  state.lease = lease;
  target.addEventListener("dispose", () => { released = true; lease.release(); });
  state.promise = lease.promise.then((texture) => {
    if (released || options.signal?.aborted) throw new DOMException("Texture request released.", "AbortError");
    target.source = texture.source;
    target.flipY = texture.flipY;
    target.userData.threeJsonResolvedUrl = lease.resolvedSource;
    target.needsUpdate = true;
    state.state = "ready";
    return target;
  }).catch((error) => {
    state.state = error?.name === "AbortError" ? "cancelled" : "error";
    lease.release();
    throw error;
  });
  state.promise.catch(() => {});
  return target;
}

export function cloneTextureResource(texture) {
  const copy = texture.clone();
  const original = requests.get(texture);
  const lease = original?.lease?.retain();
  if (lease) {
    let released = false;
    const state = { state: original.state, lease, promise: null };
    copy.addEventListener("dispose", () => { released = true; lease.release(); });
    state.promise = lease.promise.then((loaded) => {
      if (released) throw new DOMException("Texture view released.", "AbortError");
      copy.source = loaded.source; copy.needsUpdate = true; state.state = "ready"; return copy;
    }).catch((error) => { state.state = error?.name === "AbortError" ? "cancelled" : "error"; lease.release(); throw error; });
    state.promise.catch(() => {});
    requests.set(copy, state);
  }
  return copy;
}

/** Commit only a decoded texture, and only if this request still owns the binding. */
const materialRequests = new WeakMap();
export function getMaterialTextureRequest(material, field) {
  return materialRequests.get(material)?.get(field)?.texture || material?.[field] || null;
}
export function bindTextureWhenReady(material, field, texture, options = {}) {
  let slots = materialRequests.get(material);
  if (!slots) { slots = new Map(); materialRequests.set(material, slots); }
  const ticket = { texture };
  const previous = material[field];
  slots.set(field, ticket);
  let disposed = false;
  const onDispose = () => { disposed = true; if (slots.get(field) === ticket) slots.delete(field); texture.dispose?.(); };
  material.addEventListener?.("dispose", onDispose);
  const promise = whenTextureReady(texture).then(() => {
    if (disposed || slots.get(field) !== ticket || material[field] !== previous || options.isCurrent?.() === false) { texture.dispose?.(); return null; }
    material[field] = texture;
    // Engine-owned views are per binding. External/shared user textures retain
    // their caller-owned lifetime; disposing one must not invalidate a sibling.
    if (previous !== texture && requests.has(previous)) previous.dispose?.();
    if (field === "alphaMap") material.transparent = true;
    material.needsUpdate = true;
    return texture;
  }).catch((error) => {
    options.onError?.(error);
    texture.dispose?.();
    throw error;
  }).finally(() => material.removeEventListener?.("dispose", onDispose));
  promise.catch(() => {});
  return promise;
}

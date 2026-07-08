/**
 * Declarative scene.background / scene.environment resolution (LDR equirect, cube maps, HDR+PMREM).
 * Resources created and managed by ThreeJSON are tagged for dispose.
 */

import * as THREE from "three";
import { log } from "../util/logger.js";
import { resolvePublicAssetUrl } from "../util/assetsBase.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { PMREMGenerator } from "three";

const OWNED = "threeJsonOwnedBackdrop";

function markOwnedTexture(tex) {
  if (tex && tex.isTexture) {
    tex.userData = { ...tex.userData, [OWNED]: true };
  }
}

function disposeIfOwned(tex) {
  if (tex && tex.isTexture && tex.userData?.[OWNED] === true) {
    tex.dispose?.();
  }
}

/**
 * Dispose managed background / environment maps and PMREM resources attached to scene by this module.
 * @param {import("three").Scene} scene
 */
export function disposeThreeJsonSceneBackdrop(scene) {
  const bag = scene?.userData?.threeJsonBackdropDisposable;
  if (!bag) {
    return;
  }
  if (typeof bag.dispose === "function") {
    try {
      bag.dispose();
    } catch (_e) {
      /* ignore */
    }
  }
  delete scene.userData.threeJsonBackdropDisposable;
}

function setBackdropDisposable(scene, disposeFn) {
  disposeThreeJsonSceneBackdrop(scene);
  scene.userData.threeJsonBackdropDisposable = { dispose: disposeFn };
}

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function toColor(value, fallback = 0x000000) {
  try {
    return new THREE.Color(value ?? fallback);
  } catch (_e) {
    return new THREE.Color(fallback);
  }
}

function applyLdrColorSpace(texture, hint) {
  if (!texture || !texture.isTexture) {
    return;
  }
  const space = hint || "srgb";
  if (space === "srgb" && THREE.SRGBColorSpace) {
    texture.colorSpace = THREE.SRGBColorSpace;
  } else if (space === "linear" && THREE.LinearSRGBColorSpace) {
    texture.colorSpace = THREE.LinearSRGBColorSpace;
  } else if (THREE.SRGBColorSpace) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
}

/**
 * @param {object} deps
 * @param {string} [deps.path]
 * @param {string} [deps.resourcePath]
 * @param {string} [deps.crossOrigin]
 * @param {import("three").LoadingManager} [deps.loadingManager]
 */
function applyLoaderPaths(loader, deps = {}) {
  if (typeof deps.path === "string" && deps.path !== "") {
    loader.setPath(deps.path.endsWith("/") ? deps.path : `${deps.path}/`);
  }
  const rp = typeof deps.resourcePath === "string" ? deps.resourcePath.trim() : "";
  if (rp !== "") {
    loader.setResourcePath(rp.endsWith("/") ? rp : `${rp}/`);
  }
  if (typeof deps.crossOrigin === "string") {
    loader.setCrossOrigin(deps.crossOrigin);
  }
}

function loadTextureAsync(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function loadImageAsync(url, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (typeof crossOrigin === "string") {
      img.crossOrigin = crossOrigin;
    }
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err || new Error(`Image load failed: ${url}`));
    img.src = url;
  });
}

function cropToCanvas(source, sx, sy, sw, sh) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.floor(sw));
  c.height = Math.max(1, Math.floor(sh));
  const ctx = c.getContext("2d");
  if (!ctx) {
    throw new Error("sceneBackdropResolver: 2d context unavailable");
  }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/**
 * Horizontal cross (4×3 grid), matching the diagram in `docs/zh/json-format.md`.
 * Row 0 center: +Y; row 1: -X, +Z, +X, -Z; row 2 center: -Y.
 * CubeTexture order: +X -X +Y -Y +Z -Z
 */
function splitCubeCrossHorizontal(img) {
  const w = img.width;
  const h = img.height;
  const cw = w / 4;
  const ch = h / 3;
  const faces = [
    [2, 1],
    [0, 1],
    [1, 0],
    [1, 2],
    [1, 1],
    [3, 1]
  ];
  const out = [];
  for (let i = 0; i < faces.length; i++) {
    const [col, row] = faces[i];
    out.push(cropToCanvas(img, col * cw, row * ch, cw, ch));
  }
  return out;
}

function splitCubeStripHorizontal(img) {
  const w = img.width;
  const h = img.height;
  const cw = w / 6;
  const ch = h;
  const out = [];
  for (let i = 0; i < 6; i++) {
    out.push(cropToCanvas(img, i * cw, 0, cw, ch));
  }
  return out;
}

function splitCubeStripVertical(img) {
  const w = img.width;
  const h = img.height;
  const cw = w;
  const ch = h / 6;
  const out = [];
  for (let i = 0; i < 6; i++) {
    out.push(cropToCanvas(img, 0, i * ch, cw, ch));
  }
  return out;
}

function makeCubeTextureFromCanvases(canvases) {
  const cube = new THREE.CubeTexture(canvases);
  applyLdrColorSpace(cube, "srgb");
  cube.needsUpdate = true;
  markOwnedTexture(cube);
  return cube;
}

/**
 * @param {*} value sceneConfig.scene.background
 * @param {object} deps
 * @returns {Promise<import("three").Color|import("three").Texture|import("three").CubeTexture|null>}
 */
export async function resolveSceneBackgroundValue(value, deps = {}) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    return toColor(value, 0x000000);
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const t = String(value.type || "").trim().toLowerCase();
  if (!t) {
    log.warn("sceneBackdropResolver: background object missing type; ignored");
    return null;
  }
  if (t === "color") {
    return toColor(value.value ?? "#000000", 0x000000);
  }
  if (t === "equirect") {
    const url = typeof value.url === "string" ? value.url.trim() : "";
    if (!url) {
      log.warn("sceneBackdropResolver: equirect missing url");
      return null;
    }
    const loader = new THREE.TextureLoader(deps.loadingManager);
    applyLoaderPaths(loader, deps);
    const tex = await loadTextureAsync(loader, resolvePublicAssetUrl(url));
    tex.mapping = THREE.EquirectangularReflectionMapping;
    applyLdrColorSpace(tex, value.colorSpace);
    markOwnedTexture(tex);
    return tex;
  }
  if (t === "cube") {
    const layout = String(value.layout || "faces").trim().toLowerCase();
    if (layout === "faces") {
      const urls = Array.isArray(value.urls) ? value.urls.map((u) => String(u || "").trim()).filter(Boolean) : [];
      if (urls.length !== 6) {
        log.warn("sceneBackdropResolver: cube faces require exactly 6 urls");
        return null;
      }
      const loader = new THREE.CubeTextureLoader(deps.loadingManager);
      applyLoaderPaths(loader, deps);
      const cube = await new Promise((resolve, reject) => {
        loader.load(urls, resolve, undefined, reject);
      });
      applyLdrColorSpace(cube, value.colorSpace);
      markOwnedTexture(cube);
      return cube;
    }
    const singleUrl = typeof value.url === "string" ? value.url.trim() : "";
    if (!singleUrl) {
      log.warn("sceneBackdropResolver: cube single-image layout requires url");
      return null;
    }
    const absUrl = buildAbsoluteUrl(resolvePublicAssetUrl(singleUrl), deps);
    const img = await loadImageAsync(absUrl, deps.crossOrigin);
    let faces;
    if (layout === "cross-h" || layout === "cross-horizontal") {
      faces = splitCubeCrossHorizontal(img);
    } else if (layout === "strip-h" || layout === "strip-horizontal") {
      faces = splitCubeStripHorizontal(img);
    } else if (layout === "strip-v" || layout === "strip-vertical") {
      faces = splitCubeStripVertical(img);
    } else {
      log.warn(`sceneBackdropResolver: unsupported cube.layout: ${layout}`);
      return null;
    }
    return makeCubeTextureFromCanvases(faces);
  }
  log.warn(`sceneBackdropResolver: unsupported background.type: ${t}`);
  return null;
}

function buildAbsoluteUrl(url, deps) {
  if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  const base =
    (typeof deps.resourcePath === "string" && deps.resourcePath.trim() !== ""
      ? deps.resourcePath.trim().replace(/\/?$/, "/")
      : "") +
    (typeof deps.path === "string" && deps.path.trim() !== "" ? deps.path.trim().replace(/\/?$/, "/") : "");
  if (!base) {
    return url;
  }
  return base + url.replace(/^\//, "");
}

/**
 * @param {*} value sceneConfig.scene.environment
 * @param {import("three").WebGLRenderer} renderer
 * @param {object} deps
 * @returns {Promise<{ texture: import("three").Texture, disposeFn: () => void }|null>}
 */
export async function resolveSceneEnvironmentValue(value, renderer, deps = {}) {
  if (value == null || value === "") {
    return null;
  }
  if (!renderer || renderer.isWebGLRenderer !== true) {
    log.warn("sceneBackdropResolver: environment requires WebGLRenderer");
    return null;
  }
  if (typeof value !== "object") {
    log.warn("sceneBackdropResolver: environment must be an object");
    return null;
  }
  const t = String(value.type || "").trim().toLowerCase();
  const url = typeof value.url === "string" ? value.url.trim() : "";

  if (t === "equirect") {
    if (!url) {
      log.warn("sceneBackdropResolver: environment equirect missing url");
      return null;
    }
    const loader = new THREE.TextureLoader(deps.loadingManager);
    applyLoaderPaths(loader, deps);
    const equirectTex = await loadTextureAsync(loader, resolvePublicAssetUrl(url));
    equirectTex.mapping = THREE.EquirectangularReflectionMapping;
    applyLdrColorSpace(equirectTex, value.colorSpace);
    return pmremEnvironmentFromEquirectTexture(equirectTex, renderer, { disposeSource: true });
  }

  if (t !== "equirect-hdr" && t !== "hdr-equirect") {
    log.warn(`sceneBackdropResolver: unsupported environment.type: ${t || "(empty)"}`);
    return null;
  }
  if (!url) {
    log.warn("sceneBackdropResolver: equirect-hdr missing url");
    return null;
  }

  const rgbLoader = new RGBELoader(deps.loadingManager);
  applyLoaderPaths(rgbLoader, deps);
  const hdrTexture = await new Promise((resolve, reject) => {
    rgbLoader.load(resolvePublicAssetUrl(url), resolve, undefined, reject);
  });

  return pmremEnvironmentFromEquirectTexture(hdrTexture, renderer, { disposeSource: true });
}

/**
 * @param {import("three").Texture} equirectTexture
 * @param {import("three").WebGLRenderer} renderer
 * @param {{ disposeSource?: boolean }} [opts]
 */
function pmremEnvironmentFromEquirectTexture(equirectTexture, renderer, opts = {}) {
  const pmremGenerator = new PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  const rt = pmremGenerator.fromEquirectangular(equirectTexture);
  const envMap = rt.texture;
  markOwnedTexture(envMap);

  const disposeFn = () => {
    try {
      pmremGenerator.dispose();
    } catch (_e) {
      /* ignore */
    }
    disposeIfOwned(envMap);
    if (opts.disposeSource) {
      equirectTexture?.dispose?.();
    }
    rt?.dispose?.();
  };

  return { texture: envMap, disposeFn };
}

/**
 * Async-resolve background / environment from sceneHints and write to scene (overwrites same-named fields).
 * @param {import("three").Scene} scene
 * @param {object} sceneHints stripObjType(runtime.scene)
 * @param {import("three").WebGLRenderer|null} renderer
 * @param {object} [deps] path / resourcePath / crossOrigin / loadingManager
 */
export async function applySceneBackdropFromHints(scene, sceneHints = {}, renderer = null, deps = {}) {
  const mergedDeps = {
    path: deps.path ?? sceneHints.path,
    resourcePath: deps.resourcePath ?? sceneHints.resourcePath,
    crossOrigin: deps.crossOrigin ?? sceneHints.crossOrigin,
    loadingManager: deps.loadingManager
  };

  const disposeFns = [];

  if (hasOwn(sceneHints, "background")) {
    const bg = await resolveSceneBackgroundValue(sceneHints.background, mergedDeps);
    scene.background = bg;
    if (bg && bg.isTexture) {
      disposeFns.push(() => disposeIfOwned(bg));
    }
  }

  if (hasOwn(sceneHints, "environment")) {
    if (!renderer) {
      log.warn("sceneBackdropResolver: environment configured but renderer missing; skipped");
    } else {
      const envResult = await resolveSceneEnvironmentValue(sceneHints.environment, renderer, mergedDeps);
      if (envResult && envResult.texture) {
        scene.environment = envResult.texture;
        disposeFns.push(envResult.disposeFn);
      }
    }
  }

  if (disposeFns.length > 0) {
    setBackdropDisposable(scene, () => {
      for (let i = disposeFns.length - 1; i >= 0; i--) {
        try {
          disposeFns[i]();
        } catch (_e) {
          /* ignore */
        }
      }
      if (scene.background?.userData?.[OWNED] === true) {
        scene.background = null;
      }
      if (scene.environment?.userData?.[OWNED] === true) {
        scene.environment = null;
      }
    });
  }
}

/**
 * Return true when scene config includes background / environment that need async loading.
 * @param {object} sceneCfg
 */
/**
 * Sync-apply immediately resolvable backgrounds from sceneHints (solid / string color); skip types that need texture loading.
 * @param {import("three").Scene} scene
 * @param {object} sceneHints
 * @param {{ strict?: boolean }} [options]
 */
export function applySceneBackdropSimpleFromHints(scene, sceneHints = {}, options = {}) {
  const strict = options.strict === true;
  if (hasOwn(sceneHints, "background")) {
    const bg = sceneHints.background;
    if (typeof bg === "string") {
      scene.background = toColor(bg, 0x000000);
    } else if (bg && typeof bg === "object") {
      const t = String(bg.type || "").trim().toLowerCase();
      if (!t || t === "color") {
        scene.background = toColor(bg.value ?? "#000000", 0x000000);
      } else if (strict) {
        throw new Error(
          `[createJsonSceneSimple] scene.background.type="${t}" requires async loading; use createJsonScene or remove this config`
        );
      } else {
        log.warn(
          "[createJsonSceneSimple] skipped async scene.background:",
          t
        );
      }
    }
  }
  if (hasOwn(sceneHints, "environment")) {
    if (strict) {
      throw new Error(
        "[createJsonSceneSimple] scene.environment requires async loading; use createJsonScene or remove this config"
      );
    }
    log.warn("[createJsonSceneSimple] skipped scene.environment (requires async loading)");
  }
}

export function sceneConfigNeedsAsyncBackdrop(sceneCfg = {}) {
  if (!sceneCfg || typeof sceneCfg !== "object") {
    return false;
  }
  const bg = sceneCfg.background;
  if (bg && typeof bg === "object" && String(bg.type || "").trim()) {
    const t = String(bg.type).trim().toLowerCase();
    if (t !== "color") {
      return true;
    }
  }
  const env = sceneCfg.environment;
  if (env && typeof env === "object" && String(env.type || "").trim()) {
    return true;
  }
  return false;
}

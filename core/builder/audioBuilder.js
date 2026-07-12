/**
 * Declarative scene audio: `objType: "audio"`, supports `ambient` (camera listener) and `positional` (spatialized).
 * Depends on {@link THREE.AudioListener} on main camera; lazily created and reused by {@link ensureThreeJsonAudioListener}.
 */
import * as THREE from "three";
import { log } from "../util/logger.js";
import { loadingManager } from "../cache/loading.js";
import { registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { hasValue } from "../util/util.js";
import { resolvePublicAssetUrl } from "../util/assetsBase.js";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";

const LISTENER_USERDATA_KEY = "threeJsonAudioListener";
const SCENE_AUDIO_TAG_KEY = "threeJsonSceneAudio";
const WAS_PLAYING_USERDATA_KEY = "threeJsonWasPlaying";

/**
 * Scene audio session generation + pause/volume policy, per RuntimeContext (see
 * core/runtime/runtimeContext.js), so muting/tearing down one scene's audio doesn't
 * affect a concurrently-mounted sibling scene's. Functions below take an optional
 * trailing `runtimeScope` (usually the scene, already available at every call site);
 * omitting it preserves today's shared-global behavior.
 */
export function createAudioSessionStore() {
  /** Incremented on teardown; discards pending AudioLoader callbacks. */
  let sceneAudioSessionId = 0;
  /** @type {{ paused: boolean, masterVolume: number }} */
  const sceneAudioPlaybackPolicy = { paused: false, masterVolume: 1 };

  function reset() {
    sceneAudioSessionId += 1;
  }

  return {
    get sessionId() {
      return sceneAudioSessionId;
    },
    invalidateSession() {
      sceneAudioSessionId += 1;
      return sceneAudioSessionId;
    },
    policy: sceneAudioPlaybackPolicy,
    dispose: reset
  };
}

function resolveAudioStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).audioSession;
}

/** @param {import("three").Object3D|null|undefined} node */
function isThreeJsonAudioNode(node) {
  if (!node) {
    return false;
  }
  const t = node.type;
  return t === "Audio" || t === "PositionalAudio";
}

/** @param {import("three").Object3D|null|undefined} node */
function isThreeJsonAudioListener(node) {
  return node?.type === "AudioListener";
}

/**
 * Volume and pause policy synced by player/editor before async load completes.
 * @param {{ paused?: boolean, masterVolume?: number }} [policy]
 */
export function setThreeJsonSceneAudioPlaybackPolicy(policy = {}, runtimeScope) {
  const sceneAudioPlaybackPolicy = resolveAudioStore(runtimeScope).policy;
  if (typeof policy.paused === "boolean") {
    sceneAudioPlaybackPolicy.paused = policy.paused;
  }
  if (Number.isFinite(policy.masterVolume)) {
    sceneAudioPlaybackPolicy.masterVolume = Math.min(1, Math.max(0, Number(policy.masterVolume)));
  }
}

/** @returns {{ paused: boolean, masterVolume: number }} */
export function getThreeJsonSceneAudioPlaybackPolicy(runtimeScope) {
  return { ...resolveAudioStore(runtimeScope).policy };
}

/** @returns {number} */
export function getThreeJsonSceneAudioSessionId(runtimeScope) {
  return resolveAudioStore(runtimeScope).sessionId;
}

/** @returns {number} New session id */
export function invalidateThreeJsonSceneAudioSession(runtimeScope) {
  return resolveAudioStore(runtimeScope).invalidateSession();
}

function isTaggedSceneAudio(node) {
  return isThreeJsonAudioNode(node) && node.userData?.[SCENE_AUDIO_TAG_KEY] === true;
}

/** @param {import("three").Object3D|null|undefined} node */
export function isTaggedThreeJsonSceneAudioNode(node) {
  return isTaggedSceneAudio(node);
}

/** @param {import("three").Object3D|null|undefined} camera */
export function ensureThreeJsonAudioListener(camera) {
  if (!camera) {
    return null;
  }
  const existing = camera.userData?.[LISTENER_USERDATA_KEY];
  if (existing && isThreeJsonAudioListener(existing)) {
    return existing;
  }
  const listener = new THREE.AudioListener();
  camera.userData = { ...camera.userData, [LISTENER_USERDATA_KEY]: listener };
  camera.add(listener);
  return listener;
}

/**
 * Remove non-listener {@link THREE.Audio} attached by ThreeJSON from camera (e.g. ambient BGM) and disconnect nodes.
 * @param {import("three").Object3D|null|undefined} camera
 */
export function cleanupThreeJsonAudioAttachments(camera) {
  if (!camera || !Array.isArray(camera.children)) {
    return;
  }
  const snapshot = [...camera.children];
  for (let i = 0; i < snapshot.length; i++) {
    const child = snapshot[i];
    if (isTaggedSceneAudio(child)) {
      disposeThreeJsonAudioNode(child);
      camera.remove(child);
    }
  }
}

/**
 * Try to resume listener-associated `AudioContext` (unlock autoplay after user gesture).
 * @param {import("three").AudioListener|null|undefined} listener
 * @returns {Promise<void>}
 */
export function resumeThreeJsonAudioContext(listener) {
  const ctx = listener?.context;
  if (!ctx) {
    return Promise.resolve();
  }
  if (ctx.state === "suspended" && typeof ctx.resume === "function") {
    return Promise.resolve(ctx.resume()).then(() => {});
  }
  return Promise.resolve();
}

/**
 * Suspend listener-associated `AudioContext` (scene switch teardown).
 * @param {import("three").AudioListener|null|undefined} listener
 * @returns {Promise<void>}
 */
export function suspendThreeJsonAudioContext(listener) {
  const ctx = listener?.context;
  if (!ctx) {
    return Promise.resolve();
  }
  if (ctx.state === "running" && typeof ctx.suspend === "function") {
    return Promise.resolve(ctx.suspend()).then(() => {});
  }
  return Promise.resolve();
}

/**
 * Resume `AudioContext` from ThreeJSON listener on main camera.
 * @param {import("three").Object3D|null|undefined} camera
 * @returns {Promise<void>}
 */
export function resumeThreeJsonAudioContextFromCamera(camera) {
  const listener = camera?.userData?.[LISTENER_USERDATA_KEY];
  return resumeThreeJsonAudioContext(listener);
}

/**
 * Stop and disconnect Three.js {@link THREE.Audio} / {@link THREE.PositionalAudio} nodes.
 * @param {import("three").Object3D|null|undefined} node
 * @returns {boolean} Whether node is audio and was handled
 */
export function disposeThreeJsonAudioNode(node) {
  if (!isThreeJsonAudioNode(node)) {
    return false;
  }
  try {
    if (typeof node.stop === "function") {
      node.stop();
    }
  } catch (_e) {
    /* ignore */
  }
  try {
    if (typeof node.disconnect === "function") {
      node.disconnect();
    }
  } catch (_e) {
    /* ignore */
  }
  return true;
}

/**
 * Traverse camera children and scene audio tagged by ThreeJSON on scene.
 * @param {import("three").Object3D|null|undefined} camera
 * @param {import("three").Object3D|null|undefined} sceneRoot
 * @param {(node: import("three").Audio) => void} callback
 */
export function forEachThreeJsonSceneAudioNode(camera, sceneRoot, callback) {
  if (!callback) {
    return;
  }
  if (camera && Array.isArray(camera.children)) {
    const snapshot = [...camera.children];
    for (let i = 0; i < snapshot.length; i++) {
      const child = snapshot[i];
      if (isTaggedSceneAudio(child)) {
        callback(child);
      }
    }
  }
  if (sceneRoot && typeof sceneRoot.traverse === "function") {
    sceneRoot.traverse((node) => {
      if (isTaggedSceneAudio(node)) {
        callback(node);
      }
    });
  }
}

/**
 * Stop and remove all ThreeJSON scene audio (scene switch teardown).
 * @param {import("three").Object3D|null|undefined} camera
 * @param {import("three").Object3D|null|undefined} sceneRoot
 */
export function disposeAllThreeJsonSceneAudio(camera, sceneRoot) {
  forEachThreeJsonSceneAudioNode(camera, sceneRoot, (node) => {
    disposeThreeJsonAudioNode(node);
    node.parent?.remove?.(node);
  });
}

/**
 * Pause playing ThreeJSON audio in current scene (editor mute; does not destroy nodes).
 * @param {import("three").Object3D|null|undefined} camera
 * @param {import("three").Object3D|null|undefined} sceneRoot
 */
export function pauseAllThreeJsonSceneAudio(camera, sceneRoot) {
  forEachThreeJsonSceneAudioNode(camera, sceneRoot, (node) => {
    const playing = node.isPlaying === true;
    node.userData = {
      ...node.userData,
      [WAS_PLAYING_USERDATA_KEY]: playing
    };
    if (!playing) {
      return;
    }
    if (typeof node.pause === "function") {
      node.pause();
    } else if (typeof node.stop === "function") {
      node.stop();
    }
  });
}

/**
 * Resume audio marked playing by {@link pauseAllThreeJsonSceneAudio}.
 * @param {import("three").Object3D|null|undefined} camera
 * @param {import("three").Object3D|null|undefined} sceneRoot
 */
export function resumeAllThreeJsonSceneAudio(camera, sceneRoot) {
  forEachThreeJsonSceneAudioNode(camera, sceneRoot, (node) => {
    if (node.userData?.[WAS_PLAYING_USERDATA_KEY] === true) {
      const playPromise = node.play?.();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          /* Browser autoplay policy, etc. */
        });
      }
    }
    const nextUd = { ...node.userData };
    delete nextUd[WAS_PLAYING_USERDATA_KEY];
    node.userData = nextUd;
  });
}

/**
 * @param {{ camera?: import("three").Camera|null, scene?: import("three").Scene|null }|import("three").Scene|null|undefined} runtime
 * @returns {{ camera: import("three").Camera|null, scene: import("three").Scene|null }}
 */
export function getThreeJsonSceneAudioRoots(runtime) {
  const scene = runtime?.scene?.isScene === true
    ? runtime.scene
    : (runtime?.isScene === true ? runtime : null);
  return {
    camera: runtime?.camera ?? null,
    scene
  };
}

/**
 * Detach ThreeJSON {@link THREE.AudioListener} from camera and try to suspend AudioContext.
 * @param {import("three").Object3D|null|undefined} camera
 */
export function detachThreeJsonAudioListener(camera) {
  if (!camera) {
    return;
  }
  cleanupThreeJsonAudioAttachments(camera);
  const listener = camera.userData?.[LISTENER_USERDATA_KEY];
  if (!listener || !isThreeJsonAudioListener(listener)) {
    return;
  }
  suspendThreeJsonAudioContext(listener).catch(() => {});
  try {
    camera.remove(listener);
  } catch (_e) {
    /* ignore */
  }
  const nextUd = { ...camera.userData };
  delete nextUd[LISTENER_USERDATA_KEY];
  camera.userData = nextUd;
}

/**
 * Pause or resume scene audio on runtime (does not destroy nodes).
 * @param {{ camera?: import("three").Camera|null, scene?: import("three").Scene|null }|null|undefined} runtime
 * @param {boolean} paused
 */
export function setThreeJsonSceneAudioPaused(runtime, paused) {
  const { camera, scene } = getThreeJsonSceneAudioRoots(runtime);
  setThreeJsonSceneAudioPlaybackPolicy({ paused }, scene);
  if (paused) {
    pauseAllThreeJsonSceneAudio(camera, scene);
  } else {
    resumeAllThreeJsonSceneAudio(camera, scene);
  }
}

/**
 * Resume AudioContext after user gesture and retry scene audio with autoplay (common on first page open).
 * @param {EventTarget|null|undefined} target
 * @param {() => ({ camera?: import("three").Camera|null, scene?: import("three").Scene|null }|null|undefined)} getRuntime
 */
export function bindThreeJsonSceneAudioUnlock(target, getRuntime) {
  if (!target || target.__threeJsonSceneAudioUnlockBound === true) {
    return;
  }
  target.__threeJsonSceneAudioUnlockBound = true;
  const onUnlock = () => {
    const runtime = typeof getRuntime === "function" ? getRuntime() : null;
    const { camera, scene } = getThreeJsonSceneAudioRoots(runtime);
    void resumeThreeJsonAudioContextFromCamera(camera).then(() => {
      const { paused } = getThreeJsonSceneAudioPlaybackPolicy(scene);
      forEachThreeJsonSceneAudioNode(camera, scene, (node) => {
        const rec = node.userData?.objJson;
        if (rec?.autoplay === true && node.isPlaying !== true && !paused) {
          const playPromise = node.play?.();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => {});
          }
        }
      });
    });
  };
  target.addEventListener("pointerdown", onUnlock, { once: true, capture: true });
  target.addEventListener("keydown", onUnlock, { once: true, capture: true });
}

/**
 * @param {import("three").AudioListener} listener
 * @param {import("three").Audio} sound
 * @param {object} record
 * @param {*} [runtimeScope]
 */
function startSceneAudioPlayback(listener, sound, record, runtimeScope) {
  const sceneAudioPlaybackPolicy = getThreeJsonSceneAudioPlaybackPolicy(runtimeScope);
  if (listener && typeof listener.setMasterVolume === "function") {
    listener.setMasterVolume(sceneAudioPlaybackPolicy.masterVolume);
  }
  if (sceneAudioPlaybackPolicy.paused) {
    if (sound.isPlaying === true && typeof sound.pause === "function") {
      sound.pause();
    }
    return;
  }
  if (record.autoplay !== true) {
    return;
  }
  const playPromise = sound.play?.();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      /* Browser autoplay policy, etc. */
    });
  }
}

/**
 * Clean all scene audio on createJsonScene runtime and invalidate in-flight loads.
 * @param {{ camera?: import("three").Camera|null, scene?: import("three").Scene|null }|null|undefined} runtime
 */
export function teardownThreeJsonSceneAudioFromRuntime(runtime) {
  const { camera, scene } = getThreeJsonSceneAudioRoots(runtime);
  invalidateThreeJsonSceneAudioSession(scene);
  if (!runtime) {
    return;
  }
  disposeAllThreeJsonSceneAudio(camera, scene);
  detachThreeJsonAudioListener(camera);
}

function toVector3(value, defaultValue = { x: 0, y: 0, z: 0 }) {
  return {
    x: hasValue(value?.x) ? Number(value.x) : defaultValue.x,
    y: hasValue(value?.y) ? Number(value.y) : defaultValue.y,
    z: hasValue(value?.z) ? Number(value.z) : defaultValue.z
  };
}

function normalizeAudioMode(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "ambient" || raw === "bgm" || raw === "global") {
    return "ambient";
  }
  return "positional";
}

export function resolveAudioUrl(record) {
  if (typeof record?.audioUrl === "string" && record.audioUrl.trim()) {
    return resolvePublicAssetUrl(record.audioUrl.trim());
  }
  if (typeof record?.url === "string" && record.url.trim()) {
    return resolvePublicAssetUrl(record.url.trim());
  }
  return "";
}

/**
 * Configure and attach one audio record (async buffer load).
 * @param {object} record
 * @param {import("three").Object3D} scene
 * @param {{ camera?: import("three").Camera|null, renderer?: import("three").WebGLRenderer|null }} ctx
 */
export function deploySceneAudio(record, scene, ctx) {
  const camera = ctx?.camera;
  if (!camera) {
    log.warn("[deploySceneAudio] missing camera, skipped", record?.name || "");
    return;
  }
  const url = resolveAudioUrl(record);
  if (!url) {
    log.warn("[deploySceneAudio] missing audioUrl / url, skipped", record?.name || "");
    return;
  }
  const listener = ensureThreeJsonAudioListener(camera);
  if (!listener) {
    return;
  }

  const mode = normalizeAudioMode(record.mode);
  const loadSession = getThreeJsonSceneAudioSessionId(scene);
  const loader = new THREE.AudioLoader(loadingManager);
  loader.load(
    url,
    (buffer) => {
      if (loadSession !== getThreeJsonSceneAudioSessionId(scene)) {
        return;
      }
      const sound =
        mode === "ambient"
          ? new THREE.Audio(listener)
          : new THREE.PositionalAudio(listener);

      sound.setBuffer(buffer);
      if (typeof record.loop === "boolean") {
        sound.setLoop(record.loop);
      }
      if (Number.isFinite(record.volume)) {
        sound.setVolume(Number(record.volume));
      } else if (Number.isFinite(record.gain)) {
        sound.setVolume(Number(record.gain));
      }
      if (Number.isFinite(record.playbackRate) && record.playbackRate > 0) {
        sound.setPlaybackRate(Number(record.playbackRate));
      }

      if (sound instanceof THREE.PositionalAudio) {
        if (Number.isFinite(record.refDistance)) {
          sound.setRefDistance(Number(record.refDistance));
        }
        if (Number.isFinite(record.rolloffFactor)) {
          sound.setRolloffFactor(Number(record.rolloffFactor));
        }
        if (Number.isFinite(record.maxDistance)) {
          sound.setMaxDistance(Number(record.maxDistance));
        }
        if (typeof record.distanceModel === "string" && record.distanceModel.trim()) {
          sound.setDistanceModel(record.distanceModel.trim());
        }
        const inner = Number(record.coneInnerAngle);
        const outer = Number(record.coneOuterAngle);
        const outerGain = Number(record.coneOuterGain);
        if (Number.isFinite(inner) && Number.isFinite(outer) && Number.isFinite(outerGain)) {
          sound.setDirectionalCone(inner, outer, outerGain);
        }
      }

      const pos = toVector3(record.position, { x: 0, y: 0, z: 0 });
      sound.position.set(pos.x, pos.y, pos.z);
      if (typeof record.name === "string" && record.name) {
        sound.name = record.name;
      }

      const tagged = { ...record, objType: "audio", mode };
      setUserDataObjJson(sound, tagged);
      sound.userData = {
        ...sound.userData,
        [SCENE_AUDIO_TAG_KEY]: true
      };

      if (mode === "ambient") {
        camera.add(sound);
      } else if (scene) {
        scene.add(sound);
      }

      registerObject(sound, tagged);

      startSceneAudioPlayback(listener, sound, record, scene);
    },
    undefined,
    (err) => {
      log.warn("[deploySceneAudio] load failed:", url, err);
    }
  );
}

/**
 * ThreeBox-owned popup bridge for one-time scene delivery.
 *
 * The React application is intentionally independent from tools/scene-host. Its deployment origin
 * policy lives here, and only explicitly configured peer URLs can receive a scene.
 */

export const SCENE_PREVIEW_CHANNEL = "threejson:scene-preview";
export const SCENE_TRANSFER_CHANNEL = "threejson:scene-transfer";
export const SCENE_BRIDGE_VERSION = 1;

const ENV = import.meta.env || {};
const IS_DEVELOPMENT = Boolean(ENV.DEV);
const HANDSHAKE_TIMEOUT_MS = 15000;

const PRODUCTION_ORIGINS = Object.freeze([
  "https://threejson.org",
  "https://threebox.org",
  "https://cloud.threebox.org",
  "https://editor.threejson.org",
  "https://player.threejson.org",
  "https://shower.threejson.org"
]);

const DEVELOPMENT_ORIGINS = Object.freeze([
  "http://localhost:5180",
  "http://localhost:5181",
  "http://localhost:5182",
  "http://localhost:5183"
]);

function configuredUrl(key, developmentDefault, productionDefault) {
  const fallback = IS_DEVELOPMENT ? developmentDefault : productionDefault;
  const candidate = String(ENV[`VITE_THREEJSON_${key}_URL`] || fallback).trim();
  try {
    return new URL(candidate).href;
  } catch {
    return new URL(fallback).href;
  }
}

export const THREEBOX_PEER_URLS = Object.freeze({
  videoEditor: configuredUrl("VIDEO_EDITOR", "https://threejson.org/tools/scene-host/video-editor/index.html", "https://threejson.org/tools/scene-host/video-editor/index.html"),
  editor: configuredUrl("EDITOR", "http://localhost:5183/", "https://editor.threejson.org/"),
  player: configuredUrl("PLAYER", "http://localhost:5180/", "https://player.threejson.org/"),
  shower: configuredUrl("SHOWER", "http://localhost:5181/", "https://shower.threejson.org/"),
  threebox: configuredUrl("THREEBOX", "http://localhost:5182/", "https://threebox.org/")
});

export const THREEBOX_ALLOWED_ORIGINS = Object.freeze([
  ...new Set([
    ...PRODUCTION_ORIGINS,
    ...DEVELOPMENT_ORIGINS,
    ...Object.values(THREEBOX_PEER_URLS).map((value) => new URL(value).origin)
  ])
]);

function isAllowedOrigin(origin) {
  return typeof origin === "string" && THREEBOX_ALLOWED_ORIGINS.includes(origin);
}

function createBridgeSession() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint32Array(4);
  globalThis.crypto?.getRandomValues?.(bytes);
  return `${Date.now().toString(36)}-${Array.from(bytes, (value) => value.toString(36)).join("")}`;
}

function postBridgeMessage(target, channel, message, targetOrigin) {
  if (!target || target.closed || !isAllowedOrigin(targetOrigin)) {
    return false;
  }
  target.postMessage(
    { channel, version: SCENE_BRIDGE_VERSION, ...message },
    targetOrigin
  );
  return true;
}

function openSceneWithHandshake({ peer, channel, modeParam, sceneJson, label, bindSceneEvents = false }) {
  const peerUrl = THREEBOX_PEER_URLS[peer];
  const targetOrigin = peerUrl ? new URL(peerUrl).origin : null;
  const openerOrigin = typeof window !== "undefined" ? window.location.origin : null;
  if (!targetOrigin || !isAllowedOrigin(targetOrigin) || !isAllowedOrigin(openerOrigin)) {
    return Promise.reject(new Error("The configured scene peer is not in the application origin allowlist."));
  }

  const session = createBridgeSession();
  const targetUrl = new URL(peerUrl);
  targetUrl.searchParams.set(modeParam, "1");
  targetUrl.searchParams.set("bridgeSession", session);
  targetUrl.searchParams.set("openerOrigin", openerOrigin);

  const popup = window.open(targetUrl.href, `threejson-${peer}-scene-bridge`);
  if (!popup) {
    return Promise.reject(new Error("Popup blocked."));
  }

  return new Promise((resolve, reject) => {
    let sent = false;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
    };
    const fail = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onMessage = (event) => {
      const data = event?.data;
      if (
        event.origin !== targetOrigin ||
        event.source !== popup ||
        !data ||
        typeof data !== "object" ||
        data.channel !== channel ||
        data.version !== SCENE_BRIDGE_VERSION ||
        data.session !== session
      ) {
        return;
      }
      if (data.action === "ready" && !sent) {
        sent = postBridgeMessage(
          popup,
          channel,
          { action: "load", session, payload: sceneJson, label, bindSceneEvents },
          targetOrigin
        );
        if (!sent) {
          fail(new Error("The scene peer rejected the load message."));
        }
        return;
      }
      if (data.action === "loaded") {
        if (data.ok === false) {
          fail(new Error(data.error || "The scene peer could not load the scene."));
          return;
        }
        cleanup();
        resolve({ peer, session });
      }
    };
    const timeoutId = window.setTimeout(() => fail(new Error("Scene peer handshake timed out.")), peer === "videoEditor" ? 60000 : HANDSHAKE_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
  });
}

export function openSceneInEditor(sceneJson, label) {
  return openSceneWithHandshake({
    peer: "editor",
    channel: SCENE_TRANSFER_CHANNEL,
    modeParam: "sceneTransfer",
    sceneJson,
    label
  });
}

export function openSceneInVideoEditor(sceneJson, label) {
  return openSceneWithHandshake({ peer: "videoEditor", channel: SCENE_TRANSFER_CHANNEL, modeParam: "sceneTransfer", sceneJson, label });
}

export function openSceneInPlayer(sceneJson, label) {
  return openSceneWithHandshake({
    peer: "player",
    channel: SCENE_PREVIEW_CHANNEL,
    modeParam: "scenePreview",
    sceneJson,
    label,
    bindSceneEvents: false
  });
}

const WEBGPU_CAPABILITY_IDS = new Set(["webgpuTsl", "tslCode", "webgpuParticles"]);
const TSL_CODE_CAPABILITY_IDS = new Set(["tslCode"]);

let webgpuActivationPromise = null;
let webgpuActivationError = null;
let tslCodeActivationPromise = null;
let tslCodeActivationError = null;

function normalizeIdList(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

function visitForWebgpu(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => visitForWebgpu(entry, seen));
  if (String(value?.sceneConfig?.renderer?.backend || "").trim().toLowerCase() === "webgpu") return true;
  if (String(value?.renderer?.backend || "").trim().toLowerCase() === "webgpu") return true;
  if (
    String(value?.objType || "").trim().toLowerCase() === "renderer"
    && String(value?.backend || "").trim().toLowerCase() === "webgpu"
  ) return true;
  if (String(value?.material?.type || "").trim().toLowerCase() === "tsl") return true;
  if (String(value?.type || "").trim().toLowerCase() === "tsl" && value?.tsl) return true;
  if (String(value?.simulation?.backend || "").trim().toLowerCase() === "webgpu-compute") return true;
  return Object.values(value).some((entry) => visitForWebgpu(entry, seen));
}

function visitForTslCode(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => visitForTslCode(entry, seen));
  if (
    String(value?.type || "").trim().toLowerCase() === "tsl"
    && String(value?.tsl?.kind || "").trim().toLowerCase() === "code"
  ) return true;
  return Object.values(value).some((entry) => visitForTslCode(entry, seen));
}

function authorizeThreeBoxTslCode({ hash, source, code, notice } = {}) {
  if (typeof globalThis.confirm !== "function") return false;
  const sourceLabel = typeof source?.url === "string" && source.url.trim()
    ? source.url.trim()
    : "inline AI-generated module";
  const preview = String(code || "").trim().slice(0, 1200);
  return globalThis.confirm([
    "此场景请求运行 TSL JavaScript 模块。批准后，该模块拥有与 ThreeBox 页面相同的权限。",
    "请仅批准您信任或已检查的内容。场景 JSON 无权绕过本确认。",
    "",
    `来源：${sourceLabel}`,
    `SHA-256：${hash || "unknown"}`,
    notice ? `说明：${notice}` : "",
    preview ? `\n代码预览：\n${preview}${String(code || "").length > preview.length ? "\n…" : ""}` : "",
    "",
    "Run this TSL JavaScript module? It receives the same page permissions as ThreeBox."
  ].filter(Boolean).join("\n"));
}

/** ThreeBox is an advanced authoring host, so it activates the optional WebGPU entry after
 * negotiation selects it (or before replaying a descriptor that already requires it). This
 * changes only ThreeBox's host inventory; ordinary WebGL scenes never load the entry. */
export async function activateThreeBoxAiCapabilities({ tslCode = false } = {}) {
  if (tslCode) {
    if (!tslCodeActivationPromise) {
      tslCodeActivationPromise = import("threejson/tsl-code")
        .then((module) => {
          module.configureTslCodeExecution({
            executionPolicy: "prompt",
            authorize: authorizeThreeBoxTslCode
          });
          tslCodeActivationError = null;
          webgpuActivationError = null;
          webgpuActivationPromise ||= Promise.resolve(true);
          return true;
        })
        .catch((error) => {
          tslCodeActivationError = error;
          tslCodeActivationPromise = null;
          return false;
        });
    }
    return tslCodeActivationPromise;
  }
  if (!webgpuActivationPromise) {
    webgpuActivationPromise = import("threejson/webgpu")
      .then(() => {
        webgpuActivationError = null;
        return true;
      })
      .catch((error) => {
        webgpuActivationError = error;
        // A transient CDN/module failure must not permanently poison the page's Retry button.
        webgpuActivationPromise = null;
        return false;
      });
  }
  return webgpuActivationPromise;
}

export function scenePayloadRequiresWebgpu(payload) {
  return visitForWebgpu(payload);
}

export function scenePayloadRequiresTslCode(payload) {
  return visitForTslCode(payload);
}

/** Loading saved/history/template scenes cannot depend on a fresh AI turn having run first. */
export async function ensureThreeBoxSceneCapabilitiesForPayload(payload) {
  if (!scenePayloadRequiresWebgpu(payload)) return false;
  const needsTslCode = scenePayloadRequiresTslCode(payload);
  const activated = await activateThreeBoxAiCapabilities({ tslCode: needsTslCode });
  if (!activated) {
    const activationError = needsTslCode ? tslCodeActivationError : webgpuActivationError;
    const error = new Error(
      `ThreeBox could not activate the WebGPU/TSL runtime: ${activationError?.message || activationError || "unknown error"}`
    );
    error.code = "E_THREEBOX_WEBGPU_ACTIVATION_FAILED";
    error.cause = activationError;
    throw error;
  }
  return true;
}

export function shouldActivateThreeBoxTslCode({
  scene,
  selectedCapabilityIds,
  matchedCapabilityIds
} = {}) {
  if (scenePayloadRequiresTslCode(scene)) return true;
  const ids = [
    ...normalizeIdList(selectedCapabilityIds),
    ...normalizeIdList(matchedCapabilityIds)
  ];
  return ids.some((id) => TSL_CODE_CAPABILITY_IDS.has(id));
}

export function resolveThreeBoxAiRendererBackend({
  scene,
  selectedCapabilityIds,
  matchedCapabilityIds
} = {}) {
  const runtimeRendererRecord = Array.isArray(scene?.objectList)
    ? [...scene.objectList].reverse().find(
      (record) => String(record?.objType || "").trim().toLowerCase() === "renderer"
    )
    : null;
  const sceneBackend = String(
    scene?.sceneConfig?.renderer?.backend
      || runtimeRendererRecord?.backend
      || scene?.renderer?.backend
      || ""
  ).trim().toLowerCase();
  if (sceneBackend === "webgpu") return "webgpu";
  const ids = [
    ...normalizeIdList(selectedCapabilityIds),
    ...normalizeIdList(matchedCapabilityIds)
  ];
  return ids.some((id) => WEBGPU_CAPABILITY_IDS.has(id)) ? "webgpu" : "webgl";
}

/** Convert only the new adjustment result's working document when negotiation selects a WebGPU
 * capability. The earlier immutable turn remains unchanged. */
export function projectSceneToRendererBackend(scene, rendererBackend) {
  if (!scene || typeof scene !== "object" || rendererBackend !== "webgpu") return scene;
  return {
    ...scene,
    sceneConfig: {
      ...(scene.sceneConfig || {}),
      renderer: {
        ...(scene.sceneConfig?.renderer || {}),
        backend: "webgpu"
      }
    }
  };
}

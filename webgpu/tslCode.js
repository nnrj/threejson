// Importing this optional entry is the host's explicit request for the complete WebGPU/TSL
// capability. It registers the renderer/material adapter as well as the code preparer.
import "./index.js";
import { registerSceneCapability } from "../core/capabilities/sceneCapabilityManifest.js";
import { registerSceneCapabilityPreparer } from "../core/capabilities/scenePreparationRegistry.js";
import { registerPreparedTslCode, unregisterPreparedTslCode } from "./tslMaterial.js";

export const TSL_CODE_EXECUTION_POLICIES = Object.freeze([
  "trusted",
  "prompt",
  "restricted",
  "disabled"
]);

export const TSL_CODE_SECURITY_NOTICE =
  "TSL code is executable JavaScript with the host page's permissions. ThreeJSON provides the " +
  "complete module capability; the host application chooses whether sources are trusted, " +
  "confirmed, restricted, or disabled.";

const memoryAuthorizations = new Set();
const preparedSources = new Map();

// The module itself is an explicit optional import, so capability-first `trusted` is the default.
// Applications receiving untrusted scenes can select prompt/restricted/disabled before loading.
let settings = {
  executionPolicy: "trusted",
  authorize: null,
  storage: null,
  moduleLoader: null
};

function normalizeExecutionPolicy(value) {
  const policy = String(value || "trusted").trim().toLowerCase();
  if (!TSL_CODE_EXECUTION_POLICIES.includes(policy)) {
    throw new Error(
      `[tsl-code] executionPolicy must be one of: ${TSL_CODE_EXECUTION_POLICIES.join(", ")}`
    );
  }
  return policy;
}

function publishCodeCapability() {
  const enabled = settings.executionPolicy !== "disabled";
  registerSceneCapability("materials", "tsl", {
    status: "preview",
    rendererBackends: ["webgpu"],
    modes: enabled ? ["preset", "graph", "code"] : ["preset", "graph"],
    codeExecutionPolicy: settings.executionPolicy,
    entry: "threejson/tsl-code"
  });
}

function sourceKey(source) {
  return typeof source?.url === "string" && source.url.trim()
    ? `url:${source.url.trim()}`
    : `inline:${String(source?.inline || "")}`;
}

function visitCodeDescriptors(value, out, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (
    String(value.type || "").trim().toLowerCase() === "tsl"
    && String(value.tsl?.kind || "").trim().toLowerCase() === "code"
  ) {
    out.push(value.tsl);
  }
  if (Array.isArray(value)) value.forEach((entry) => visitCodeDescriptors(entry, out, seen));
  else Object.values(value).forEach((entry) => visitCodeDescriptors(entry, out, seen));
}

async function sha256(text) {
  if (!globalThis.crypto?.subtle) throw new Error("[tsl-code] Web Crypto SHA-256 is unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readSource(source) {
  if (typeof source?.inline === "string" && source.inline.trim()) return source.inline;
  const url = typeof source?.url === "string" ? source.url.trim() : "";
  if (!url) {
    throw Object.assign(new Error("TSL code requires source.inline or source.url"), {
      code: "E_TSL_CODE_SOURCE_MISSING"
    });
  }
  const response = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
  if (!response.ok) {
    throw Object.assign(new Error(`TSL code request failed: HTTP ${response.status}`), {
      code: "E_TSL_CODE_FETCH_FAILED"
    });
  }
  return response.text();
}

function assertSelfContainedModule(code) {
  // `restricted` deliberately retains the former single-file boundary. Other policies allow
  // normal ESM imports because dependencies are part of the capability, not an engine defect.
  const hasImport = /\bimport\b(?!\s*\.)/m.test(code);
  const hasReExport = /\bexport\s+(?:\*|\{[\s\S]*?\})\s+from\b/m.test(code);
  if (hasImport || hasReExport) {
    throw Object.assign(
      new Error("Restricted TSL modules must be self-contained and cannot import dependencies"),
      { code: "E_TSL_CODE_IMPORT_RESTRICTED" }
    );
  }
}

async function isAuthorized(hash, source, code, policy) {
  if (policy === "trusted") return true;
  const authorizationKey = `${hash}|${sourceKey(source)}`;
  if (memoryAuthorizations.has(authorizationKey)) return true;
  if (await settings.storage?.isAuthorized?.({ hash, source, policy })) return true;
  if (typeof settings.authorize !== "function") return false;
  const approved = await settings.authorize({
    hash,
    source,
    code,
    policy,
    notice: TSL_CODE_SECURITY_NOTICE
  });
  if (approved !== true) return false;
  memoryAuthorizations.add(authorizationKey);
  await settings.storage?.remember?.({ hash, source, policy });
  return true;
}

function resolveModuleUrl(url, hash) {
  const base = typeof document !== "undefined" && document.baseURI
    ? document.baseURI
    : import.meta.url;
  const resolved = new URL(url, base);
  // The fragment gives changed source a new module identity without changing the server request.
  resolved.hash = `threejson-${hash}`;
  return resolved.href;
}

async function defaultImportModule({ code, source, hash }) {
  const sourceUrl = typeof source?.url === "string" ? source.url.trim() : "";
  if (sourceUrl) {
    // Import the original URL rather than a Blob so relative dependencies retain normal ESM
    // resolution. URL and bare imports work according to the host's import map/module loader.
    return import(/* @vite-ignore */ resolveModuleUrl(sourceUrl, hash));
  }

  let moduleUrl;
  let revoke = null;
  if (
    typeof window !== "undefined"
    && typeof URL?.createObjectURL === "function"
    && typeof Blob !== "undefined"
  ) {
    moduleUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    revoke = () => URL.revokeObjectURL(moduleUrl);
  } else {
    const base64 = typeof Buffer !== "undefined"
      ? Buffer.from(code, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(code)));
    moduleUrl = `data:text/javascript;base64,${base64}#threejson-${hash}`;
  }
  try {
    return await import(/* @vite-ignore */ moduleUrl);
  } finally {
    revoke?.();
  }
}

async function importSourceModule({ code, source, hash, policy }) {
  const defaultImport = () => defaultImportModule({ code, source, hash });
  try {
    if (typeof settings.moduleLoader === "function") {
      return await settings.moduleLoader({ code, source, hash, policy, defaultImport });
    }
    return await defaultImport();
  } catch (cause) {
    const error = new Error(
      "TSL code module import failed; check module syntax, dependency URLs/import maps, CORS, " +
      "and the host CSP, or provide configureTslCodeExecution({ moduleLoader })."
    );
    error.code = "E_TSL_CODE_IMPORT_FAILED";
    error.cause = cause;
    error.source = source;
    throw error;
  }
}

async function prepareOne(tsl) {
  const policy = settings.executionPolicy;
  if (policy === "disabled") {
    throw Object.assign(new Error("TSL code execution is disabled by the host"), {
      code: "E_TSL_CODE_DISABLED"
    });
  }
  const source = tsl.source && typeof tsl.source === "object" ? tsl.source : {};
  const key = sourceKey(source);
  const code = await readSource(source);
  const hash = await sha256(code);
  const expected = typeof source.sha256 === "string" ? source.sha256.trim().toLowerCase() : "";
  if (expected && expected !== hash) {
    throw Object.assign(new Error("TSL code SHA-256 does not match source.sha256"), {
      code: "E_TSL_CODE_HASH_MISMATCH",
      expected,
      actual: hash
    });
  }
  if (policy === "restricted") assertSelfContainedModule(code);
  if (!(await isAuthorized(hash, source, code, policy))) {
    throw Object.assign(new Error("TSL code was not authorized by the host"), {
      code: "E_TSL_CODE_NOT_AUTHORIZED",
      hash,
      policy
    });
  }

  const previous = preparedSources.get(key);
  if (previous?.hash === hash && previous?.policy === policy) return;
  const module = await importSourceModule({ code, source, hash, policy });
  if (typeof module?.default !== "function") {
    throw Object.assign(
      new Error("TSL code module must default-export a material/node factory"),
      { code: "E_TSL_CODE_EXPORT_INVALID" }
    );
  }
  if (previous) unregisterPreparedTslCode(key);
  preparedSources.set(key, { hash, source, policy });
  registerPreparedTslCode(key, module.default);
}

/**
 * Configure application policy without changing the engine's available capability.
 * - trusted: execute requested modules normally (default after importing this optional entry)
 * - prompt: ask `authorize` once per content hash/source; imports remain available
 * - restricted: prompt plus a self-contained/no-import module boundary
 * - disabled: application refuses TSL code scenes
 */
export function configureTslCodeExecution(options = {}) {
  clearPreparedTslCode();
  settings = {
    executionPolicy: normalizeExecutionPolicy(
      options.executionPolicy ?? options.policy ?? "trusted"
    ),
    authorize: typeof options.authorize === "function" ? options.authorize : null,
    storage: options.storage && typeof options.storage === "object" ? options.storage : null,
    moduleLoader: typeof options.moduleLoader === "function" ? options.moduleLoader : null
  };
  publishCodeCapability();
  return getTslCodeExecutionState();
}

export function getTslCodeExecutionState() {
  return {
    executionPolicy: settings.executionPolicy,
    enabled: settings.executionPolicy !== "disabled",
    preparedCount: preparedSources.size,
    rememberedHashCount: memoryAuthorizations.size,
    hasCustomModuleLoader: typeof settings.moduleLoader === "function"
  };
}

export async function prepareTslCodeForPayload(payload) {
  const descriptors = [];
  visitCodeDescriptors(payload, descriptors);
  for (const descriptor of descriptors) await prepareOne(descriptor);
}

export async function revokeTslCodeAuthorization(hash) {
  const normalized = String(hash || "").trim().toLowerCase();
  for (const key of [...memoryAuthorizations]) {
    if (key.startsWith(`${normalized}|`)) memoryAuthorizations.delete(key);
  }
  for (const [key, prepared] of preparedSources) {
    if (prepared.hash === normalized) {
      preparedSources.delete(key);
      unregisterPreparedTslCode(key);
    }
  }
  await settings.storage?.revoke?.({ hash: normalized });
}

export function clearPreparedTslCode() {
  for (const key of preparedSources.keys()) unregisterPreparedTslCode(key);
  preparedSources.clear();
}

registerSceneCapabilityPreparer("tsl-code-module", prepareTslCodeForPayload);
publishCodeCapability();

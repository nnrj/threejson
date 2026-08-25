import { registerSceneCapabilityPreparer } from "../core/capabilities/scenePreparationRegistry.js";
import { registerPreparedTslCode, unregisterPreparedTslCode } from "./tslMaterial.js";

export const TSL_CODE_SECURITY_NOTICE = "TSL code is a JavaScript module with the same page permissions as the host application; it is not sandboxed shader text.";

const memoryAuthorizations = new Set();
const preparedSources = new Map();
let settings = {
  enabled: false,
  authorize: null,
  storage: null
};

function sourceKey(source) {
  return typeof source?.url === "string" && source.url.trim()
    ? `url:${source.url.trim()}`
    : `inline:${String(source?.inline || "")}`;
}

function visitCodeDescriptors(value, out, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return; seen.add(value);
  if (String(value.type || "").trim().toLowerCase() === "tsl" && String(value.tsl?.kind || "").trim().toLowerCase() === "code") out.push(value.tsl);
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
  if (!url) throw Object.assign(new Error("TSL code requires source.inline or source.url"), { code: "E_TSL_CODE_SOURCE_MISSING" });
  const response = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
  if (!response.ok) throw Object.assign(new Error(`TSL code request failed: HTTP ${response.status}`), { code: "E_TSL_CODE_FETCH_FAILED" });
  return response.text();
}

function assertSelfContainedModule(code) {
  // Approved content must be the complete executable unit. Following imports would execute
  // additional, independently mutable JavaScript that was not covered by this content hash.
  // Deliberately conservative: even an `import` token in a comment/string is rejected. Raw TSL
  // code is an opt-in escape hatch, so a harmless false positive is preferable to allowing
  // `import /* comment */ (...)` to bypass the approved-content boundary. `import.meta` is the
  // only permitted form because it does not load another module.
  const hasImport = /\bimport\b(?!\s*\.)/m.test(code);
  const hasReExport = /\bexport\s+(?:\*|\{[\s\S]*?\})\s+from\b/m.test(code);
  if (hasImport || hasReExport) {
    throw Object.assign(new Error("TSL code modules must be self-contained; external imports are not covered by the approved content hash"), {
      code: "E_TSL_CODE_IMPORT_FORBIDDEN"
    });
  }
}

async function isAuthorized(hash, source, code) {
  const authorizationKey = `${hash}|${sourceKey(source)}`;
  if (memoryAuthorizations.has(authorizationKey)) return true;
  if (await settings.storage?.isAuthorized?.({ hash, source })) return true;
  if (typeof settings.authorize !== "function") return false;
  const approved = await settings.authorize({ hash, source, code, notice: TSL_CODE_SECURITY_NOTICE });
  if (approved !== true) return false;
  memoryAuthorizations.add(authorizationKey);
  await settings.storage?.remember?.({ hash, source });
  return true;
}

async function importExactSource(code, source) {
  let moduleUrl; let revoke = null;
  if (typeof window !== "undefined" && typeof URL?.createObjectURL === "function" && typeof Blob !== "undefined") {
    moduleUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    revoke = () => URL.revokeObjectURL(moduleUrl);
  } else {
    const base64 = typeof Buffer !== "undefined"
      ? Buffer.from(code, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(code)));
    moduleUrl = `data:text/javascript;base64,${base64}`;
  }
  try {
    return await import(/* @vite-ignore */ moduleUrl);
  } catch (cause) {
    const error = new Error("TSL code module import failed; check module syntax and the host CSP");
    error.code = "E_TSL_CODE_IMPORT_FAILED"; error.cause = cause; error.source = source; throw error;
  } finally {
    revoke?.();
  }
}

async function prepareOne(tsl) {
  if (!settings.enabled) throw Object.assign(new Error("TSL code execution is disabled by the host"), { code: "E_TSL_CODE_DISABLED" });
  const source = tsl.source && typeof tsl.source === "object" ? tsl.source : {};
  const key = sourceKey(source);
  const code = await readSource(source); const hash = await sha256(code);
  assertSelfContainedModule(code);
  const previous = preparedSources.get(key);
  if (previous?.hash === hash) return;
  const expected = typeof source.sha256 === "string" ? source.sha256.trim().toLowerCase() : "";
  if (expected && expected !== hash) throw Object.assign(new Error("TSL code SHA-256 does not match source.sha256"), { code: "E_TSL_CODE_HASH_MISMATCH", expected, actual: hash });
  if (!(await isAuthorized(hash, source, code))) throw Object.assign(new Error("TSL code was not authorized for this content hash/source"), { code: "E_TSL_CODE_NOT_AUTHORIZED", hash });
  const module = await importExactSource(code, source);
  if (typeof module.default !== "function") throw Object.assign(new Error("TSL code module must default-export a material/node factory"), { code: "E_TSL_CODE_EXPORT_INVALID" });
  if (previous) unregisterPreparedTslCode(key);
  preparedSources.set(key, { hash, source }); registerPreparedTslCode(key, module.default);
}

export function configureTslCodeExecution(options = {}) {
  if (options.enabled !== true) clearPreparedTslCode();
  settings = {
    enabled: options.enabled === true,
    authorize: typeof options.authorize === "function" ? options.authorize : null,
    storage: options.storage && typeof options.storage === "object" ? options.storage : null
  };
  return getTslCodeExecutionState();
}

export function getTslCodeExecutionState() {
  return { enabled: settings.enabled, preparedCount: preparedSources.size, rememberedHashCount: memoryAuthorizations.size };
}

export async function prepareTslCodeForPayload(payload) {
  const descriptors = []; visitCodeDescriptors(payload, descriptors);
  for (const descriptor of descriptors) await prepareOne(descriptor);
}

export async function revokeTslCodeAuthorization(hash) {
  const normalized = String(hash || "").trim().toLowerCase();
  for (const key of [...memoryAuthorizations]) if (key.startsWith(`${normalized}|`)) memoryAuthorizations.delete(key);
  for (const [key, prepared] of preparedSources) if (prepared.hash === normalized) { preparedSources.delete(key); unregisterPreparedTslCode(key); }
  await settings.storage?.revoke?.({ hash: normalized });
}

export function clearPreparedTslCode() {
  for (const key of preparedSources.keys()) unregisterPreparedTslCode(key);
  preparedSources.clear();
}

registerSceneCapabilityPreparer("tsl-code-authorization", prepareTslCodeForPayload);

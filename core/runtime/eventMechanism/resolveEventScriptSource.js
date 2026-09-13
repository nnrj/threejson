/**
 * Resolve event script text from JSON config (inline / scriptUrl / lib://).
 */

import { resolveLibTokenToEventScript } from "../../cache/assetRegistry.js";
import { log } from "../../util/logger.js";
import { resolveRuntimeResourceUrl } from "../../resource/runtimeResourceUrl.js";
import { resolveRuntimeContext } from "../runtimeContext.js";
import { LIB_PREFIX } from "../../util/resolveTextureSource.js";
import { isEventScriptReference } from "./scriptReference.js";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @typedef {object} ResolvedEventScriptSource
 * @property {'inline'|'scriptUrl'|'lib'} kind
 * @property {string} source
 * @property {string} [scriptUrl]
 */

/**
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function fetchScriptTextFromUrl(url, ctx = {}) {
  const target = normalizeText(url);
  if (!target) {
    return null;
  }
  try {
    const scope = ctx.runtimeScope ?? ctx.scene ?? ctx.sceneRuntime?.scene ?? ctx.sceneRuntime;
    const context = resolveRuntimeContext(scope);
    const signal = ctx.signal ?? context.loadSignal;
    signal?.throwIfAborted();
    const response = await fetch(resolveRuntimeResourceUrl(target, scope), { signal });
    if (!response.ok) {
      log.warn("[eventMechanism] resolveEventScriptSource fetch failed", {
        url: target,
        status: response.status
      });
      return null;
    }
    const text = await response.text();
    signal?.throwIfAborted();
    return text;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    log.warn("[eventMechanism] resolveEventScriptSource fetch error", { url: target, error });
    return null;
  }
}

/**
 * @param {string} scriptUrl
 * @param {object} [ctx]
 * @returns {Promise<ResolvedEventScriptSource|null>}
 */
async function resolveScriptUrl(scriptUrl, ctx = {}) {
  const url = normalizeText(scriptUrl);
  if (!url) {
    return null;
  }
  if (url.toLowerCase().startsWith(LIB_PREFIX)) {
    const token = url.slice(LIB_PREFIX.length).trim();
    const runtimeScope = ctx.runtimeScope ?? ctx.scene ?? ctx.sceneRuntime?.scene ?? ctx.sceneRuntime ?? null;
    const hit = resolveLibTokenToEventScript(token, runtimeScope);
    if (!hit) {
      return null;
    }
    if (typeof hit.source === "string" && hit.source.length > 0) {
      return { kind: "lib", source: hit.source, scriptUrl: url };
    }
    if (typeof hit.url === "string" && hit.url.length > 0) {
      const fetched = await fetchScriptTextFromUrl(hit.url, ctx);
      if (!fetched) {
        return null;
      }
      return { kind: "lib", source: fetched, scriptUrl: url };
    }
    log.warn("[eventMechanism] eventScript lib entry has no source/url", { token, threeJsonId: ctx.threeJsonId });
    return null;
  }
  const fetched = await fetchScriptTextFromUrl(url, ctx);
  if (!fetched) {
    return null;
  }
  return { kind: "scriptUrl", source: fetched, scriptUrl: url };
}

/**
 * @param {object|null|undefined} eventConfig
 * @param {object} [ctx]
 * @returns {Promise<ResolvedEventScriptSource|null>}
 */
export async function resolveEventScriptSource(eventConfig, ctx = {}) {
  if (!eventConfig || typeof eventConfig !== "object" || Array.isArray(eventConfig)) {
    return null;
  }
  const legacyScriptUrl = normalizeText(eventConfig.scriptUrl);
  const script = typeof eventConfig.script === "string" ? eventConfig.script : "";

  if (legacyScriptUrl) {
    log.warn("[eventMechanism] events.scriptUrl is deprecated; use script with lib:// or http(s) URL", {
      threeJsonId: ctx.threeJsonId,
      eventName: ctx.eventName
    });
    return resolveScriptUrl(legacyScriptUrl, ctx);
  }

  if (script.length > 0 && isEventScriptReference(script)) {
    return resolveScriptUrl(script, ctx);
  }

  if (script.length > 0) {
    return {
      kind: "inline",
      source: script
    };
  }

  return null;
}

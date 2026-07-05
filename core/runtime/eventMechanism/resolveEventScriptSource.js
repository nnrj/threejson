/**
 * Resolve event script text from JSON config (inline / scriptUrl / lib://).
 */

import { resolveLibTokenToEventScript } from "../../cache/assetRegistry.js";
import { log } from "../../util/logger.js";
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
async function fetchScriptTextFromUrl(url) {
  const target = normalizeText(url);
  if (!target) {
    return null;
  }
  try {
    const response = await fetch(target);
    if (!response.ok) {
      log.warn("[eventMechanism] resolveEventScriptSource fetch failed", {
        url: target,
        status: response.status
      });
      return null;
    }
    return await response.text();
  } catch (error) {
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
    const hit = resolveLibTokenToEventScript(token);
    if (!hit) {
      return null;
    }
    if (typeof hit.source === "string" && hit.source.length > 0) {
      return { kind: "lib", source: hit.source, scriptUrl: url };
    }
    if (typeof hit.url === "string" && hit.url.length > 0) {
      const fetched = await fetchScriptTextFromUrl(hit.url);
      if (!fetched) {
        return null;
      }
      return { kind: "lib", source: fetched, scriptUrl: url };
    }
    log.warn("[eventMechanism] eventScript lib entry has no source/url", { token, threeJsonId: ctx.threeJsonId });
    return null;
  }
  const fetched = await fetchScriptTextFromUrl(url);
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

/**
 * Domain event contract hooks — invoke optional bindSceneEvents / executeBoundEvent
 * via businessDomainRegistry without importing concrete domains.
 */

import { getDomain } from "../../handler/businessDomainRegistry.js";
import { listQualifiedDomainIdPrefixes } from "../../handler/domainId.js";
import { log } from "../../util/logger.js";

function normalizeDomainKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRecordObjType(record) {
  const raw = record?.objType ?? record?.type;
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function isDomainDeployRecord(record) {
  if (!record || typeof record !== "object") {
    return false;
  }
  return normalizeRecordObjType(record) === "domain" && normalizeDomainKey(record.domain);
}

/**
 * @param {string} domainKey
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object} [ctx]
 * @returns {Promise<void>}
 */
export async function invokeDomainBindSceneEvents(domainKey, scene, ctx = {}) {
  const key = normalizeDomainKey(domainKey);
  if (!key) {
    return;
  }
  const domain = getDomain(key);
  const fn = domain?.bindSceneEvents;
  if (typeof fn !== "function") {
    return;
  }
  try {
    await fn(scene, { ...ctx, domainKey: key, domain });
  } catch (error) {
    log.warn("[eventMechanism] bindSceneEvents failed", { domainKey: key, error });
  }
}

/**
 * @param {object} input
 * @returns {Promise<unknown>}
 */
export async function invokeDomainExecuteBoundEvent(input) {
  const domainKey = normalizeDomainKey(input?.domainKey);
  if (!domainKey) {
    return undefined;
  }
  const domain = getDomain(domainKey);
  const fn = domain?.executeBoundEvent;
  if (typeof fn !== "function") {
    return undefined;
  }
  try {
    return await fn({
      ...input,
      domainKey,
      domain
    });
  } catch (error) {
    log.warn("[eventMechanism] executeBoundEvent failed", { domainKey, error });
    return undefined;
  }
}

/**
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object} [ctx]
 * @returns {Promise<void>}
 */
export async function invokeAllDomainBindSceneEvents(scene, ctx = {}) {
  const domainKeys = new Set();
  if (ctx?.domainKeys && Array.isArray(ctx.domainKeys)) {
    for (let i = 0; i < ctx.domainKeys.length; i++) {
      const key = normalizeDomainKey(ctx.domainKeys[i]);
      if (key) {
        domainKeys.add(key);
      }
    }
  }
  if (domainKeys.size === 0 && Array.isArray(ctx?.records)) {
    for (let i = 0; i < ctx.records.length; i++) {
      const record = ctx.records[i];
      if (isDomainDeployRecord(record)) {
        const domainKey = normalizeDomainKey(record.domain);
        if (domainKey) {
          domainKeys.add(domainKey);
          try {
            for (const prefix of listQualifiedDomainIdPrefixes(domainKey)) {
              domainKeys.add(prefix);
            }
          } catch (_error) {
            // Invalid domain ids are ignored by the domain registry as well.
          }
          const descriptor = getDomain(domainKey);
          const peers = Array.isArray(descriptor?.peerDomains) ? descriptor.peerDomains : [];
          for (let j = 0; j < peers.length; j++) {
            const peer = normalizeDomainKey(peers[j]);
            if (peer) {
              domainKeys.add(peer);
            }
          }
        }
      }
    }
  }
  for (const domainKey of domainKeys) {
    await invokeDomainBindSceneEvents(domainKey, scene, ctx);
  }
}

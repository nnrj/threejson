import { log } from "../../util/logger.js";
/**
 * particleEmitter third-party provider registry (extensions register at startup; core does not import extensions).
 */

/** @typedef {(record: object, scene: import("three").Scene|import("three").Object3D, ctx?: object) => import("three").Object3D|null} ParticleEmitterProvider */

/** @type {Map<string, ParticleEmitterProvider>} */
const providersById = new Map();

/**
 * @param {string} providerId
 * @returns {string}
 */
function normalizeProviderId(providerId) {
  return typeof providerId === "string" ? providerId.trim().toLowerCase() : "";
}

/**
 * @param {object|null|undefined} record
 * @returns {string}
 */
export function resolveParticleProviderId(record) {
  const raw = record?.provider ?? record?.particleProvider;
  const id = normalizeProviderId(typeof raw === "string" ? raw : "");
  if (!id || id === "core" || id === "default") {
    return "";
  }
  return id;
}

/**
 * @param {string} providerId
 * @param {ParticleEmitterProvider} deployer
 */
export function registerParticleEmitterProvider(providerId, deployer) {
  const key = normalizeProviderId(providerId);
  if (!key || typeof deployer !== "function") {
    throw new Error("[particleEmitter] registerParticleEmitterProvider requires providerId and deployer");
  }
  providersById.set(key, deployer);
}

/**
 * @param {string} providerId
 * @returns {ParticleEmitterProvider|null}
 */
export function getParticleEmitterProvider(providerId) {
  const key = normalizeProviderId(providerId);
  return key ? providersById.get(key) ?? null : null;
}

/**
 * @param {object} record
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object} [ctx]
 * @returns {import("three").Object3D|null|undefined} undefined = no provider dispatch
 */
export function tryDeployParticleEmitterByProvider(record, scene, ctx = {}) {
  const providerId = resolveParticleProviderId(record);
  if (!providerId) {
    return undefined;
  }
  const deployer = getParticleEmitterProvider(providerId);
  if (!deployer) {
    log.warn(`[particleEmitter] provider "${providerId}" not registered, falling back to core`);
    return undefined;
  }
  return deployer(record, scene, ctx) ?? null;
}

/** For unit tests only */
export function _clearParticleProvidersForTests() {
  providersById.clear();
}

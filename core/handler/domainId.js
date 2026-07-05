/** camelCase segment: matches legacy ids (nativeThree) and nested ids (weather.rain). */
const DOMAIN_SEGMENT_RE = /^[a-z][a-zA-Z0-9]*$/;

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isQualifiedDomainId(id) {
  if (typeof id !== "string" || !id.trim()) {
    return false;
  }
  const segments = id.trim().split(".");
  if (segments.length === 0) {
    return false;
  }
  for (let i = 0; i < segments.length; i += 1) {
    if (!DOMAIN_SEGMENT_RE.test(segments[i])) {
      return false;
    }
  }
  return true;
}

/**
 * @param {string} id
 * @returns {string}
 */
export function normalizeQualifiedDomainId(id) {
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (!isQualifiedDomainId(trimmed)) {
    throw new Error(`[domain] invalid qualified id: ${id}`);
  }
  return trimmed;
}

/**
 * @param {string} id
 * @returns {string}
 */
export function getLeafDomainSegment(id) {
  const normalized = normalizeQualifiedDomainId(id);
  const segments = normalized.split(".");
  return segments[segments.length - 1];
}

/**
 * @param {string} id
 * @returns {string|null}
 */
export function getParentQualifiedDomainId(id) {
  const normalized = normalizeQualifiedDomainId(id);
  const idx = normalized.lastIndexOf(".");
  if (idx <= 0) {
    return null;
  }
  return normalized.slice(0, idx);
}

/**
 * @param {string} id
 * @returns {string[]}
 */
export function listQualifiedDomainIdPrefixes(id) {
  const normalized = normalizeQualifiedDomainId(id);
  const segments = normalized.split(".");
  const prefixes = [];
  for (let i = 1; i < segments.length; i += 1) {
    prefixes.push(segments.slice(0, i).join("."));
  }
  return prefixes;
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isBareChildDomainLookup(id) {
  if (typeof id !== "string" || !id.trim()) {
    return false;
  }
  return !id.includes(".");
}

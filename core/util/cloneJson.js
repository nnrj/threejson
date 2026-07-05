/**
 * Deep-clone JSON-serializable descriptors/payloads (strips THREE and other non-JSON types).
 * @param {*} value
 * @returns {*}
 */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

export { cloneJson };

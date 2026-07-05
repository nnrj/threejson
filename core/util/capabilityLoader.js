/**
 * Lazy-load optional browser ESM dependencies (`import()`, not Node).
 * Used for sdf text, html2canvas, CSG, etc.; throws on failure for upstream fallback.
 */

/** @type {Map<string, Promise<unknown>>} */
const specifierCache = new Map();

/**
 * @param {string} specifier import map / bare node_modules specifier or relative URL
 * @returns {Promise<unknown>}
 */
export function loadEsmModule(specifier) {
  if (!specifierCache.has(specifier)) {
    specifierCache.set(
      specifier,
      import(specifier).catch((err) => {
        specifierCache.delete(specifier);
        throw err;
      })
    );
  }
  return specifierCache.get(specifier);
}

let sdfTextModulePromise = null;

/** @returns {Promise<typeof import("../builder/text/sdfText.js")>} */
export function loadSdfTextModule() {
  if (!sdfTextModulePromise) {
    sdfTextModulePromise = import("../builder/text/sdfText.js").catch((err) => {
      sdfTextModulePromise = null;
      throw err;
    });
  }
  return sdfTextModulePromise;
}

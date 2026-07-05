import { log } from "../util/logger.js";
import {
  createObjectUrlRegistry,
  isPackRef,
  parsePackRef
} from "../util/archiveCommon.js";

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function fileMapToBlobMap(fileMap) {
  const out = new Map();
  for (const [path, bytes] of fileMap.entries()) {
    out.set(path, new Blob([bytes]));
  }
  return out;
}

/**
 * Rewrite `pack://...` to object URLs.
 * @param {object} payload
 * @param {Map<string, Blob>} blobMap
 * @param {{ missingAssetPolicy?: "warn"|"error", onWarning?: (msg:string)=>void }} [options]
 */
function rewritePackRefsToObjectUrls(payload, blobMap, options = {}) {
  const policy = options.missingAssetPolicy === "error" ? "error" : "warn";
  const onWarning = typeof options.onWarning === "function" ? options.onWarning : (msg) => log.warn(msg);
  const urlRegistry = createObjectUrlRegistry();
  const missing = [];

  function walk(node) {
    if (!node || typeof node !== "object") {
      return node;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        node[i] = walk(node[i]);
      }
      return node;
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === "string" && isPackRef(value)) {
        const archivePath = parsePackRef(value);
        const blob = blobMap.get(archivePath);
        if (!blob) {
          const msg = `[archive] missing pack resource: ${archivePath}`;
          missing.push(archivePath);
          if (policy === "error") {
            throw new Error(msg);
          }
          onWarning(msg);
          continue;
        }
        node[key] = urlRegistry.add(blob);
        continue;
      }
      node[key] = walk(value);
    }
    return node;
  }

  const rewritten = walk(cloneJson(payload));
  return {
    payload: rewritten,
    dispose: () => urlRegistry.dispose(),
    objectUrlCount: urlRegistry.size(),
    missing
  };
}

export {
  fileMapToBlobMap,
  rewritePackRefsToObjectUrls
};

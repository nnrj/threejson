/**
 * Explicit `.tjz` archive entry point (`threejson/archive`).
 *
 * Importing this entry opts into the `fflate` dependency immediately. Ordinary scene runtimes
 * should keep importing `threejson` or `threejson/core`, whose compatibility facade loads these
 * modules only when an archive API is called.
 */
export { packTjzArchive } from "./tjzPackager.js";
// Binary file map for optional media hosts: no Base64 or object URLs allocated.
export { parseTjzArchive } from "./tjzParser.js";
export {
  inspectTjzArchiveEntry,
  isTjzLike,
  parseTjzArchiveForScene
} from "./tjzArchive.js";

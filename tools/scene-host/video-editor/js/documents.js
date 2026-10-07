import { openMediaDocument } from "@threejson/media-kit";
import { rewriteStrings } from "../../shared/js/videoProjectStorage.js";

const resourceKeys = new Set(["url", "src", "audioUrl", "textureUrl", "texturePath", "modelPath", "fontUrl", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "bumpMap", "displacementMap", "map", "buffer", "scriptUrl"]);
// Embedding a remote shot must not reinterpret its relative resources against
// the editor's URL. Rewrite resource fields only, never captions/names/scripts.
function absoluteResources(value, baseUrl, path = "") {
  if (!baseUrl || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(item => absoluteResources(item, baseUrl, path));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (typeof item === "string" && item && !/^(?:[a-z][a-z\d+.-]*:|#)/i.test(item) && (resourceKeys.has(key) || /\.geometry\.buffers(?:\.|$)/.test(path))) return [key, new URL(item, baseUrl).href];
    return [key, absoluteResources(item, baseUrl, `${path}.${key}`)];
  }));
}
const substitute = (replacements, value) => replacements.get(value.startsWith("pack:") ? `pack://${value.replace(/^pack:(\/\/)?\/*/, "")}` : value) || value;

export async function ingestMediaDocument(input, storage, options = {}) {
  const owner = await openMediaDocument(input, options);
  try {
    const document = absoluteResources(structuredClone(owner.document), owner.baseUrl), replacements = new Map();
    for (const [url, blob] of Object.entries(owner.getPackedAssets())) replacements.set(url, await storage.addAsset(blob, url.split("/").pop()));
    if (document.documentType === "composition") {
      document.scenes ??= {};
      for (const clip of document.timeline.clips) {
        if (typeof clip.source !== "string" || document.scenes[clip.source]) continue;
        const scene = await owner.loadScene(clip.source), child = owner.ownerOf(scene), local = new Map();
        for (const [url, blob] of Object.entries(child.getPackedAssets())) local.set(url, await storage.addAsset(blob, url.split("/").pop()));
        const key = `import-${crypto.randomUUID()}`;
        document.scenes[key] = rewriteStrings(absoluteResources(scene, child.baseUrl), value => substitute(local, value)); clip.source = key;
      }
    }
    return rewriteStrings(document, value => substitute(replacements, value));
  } finally { owner.dispose(); }
}

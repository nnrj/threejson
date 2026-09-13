import { createSceneTexturePlanner } from "threejson/ai";
import {
  listMaterialTextureSlots,
  runSceneTexturePipeline,
  TextureAcquisitionProvider
} from "threejson/texture";
import { sceneHostAssetUrl } from "./sceneHostPaths.js";
import { resolveTextureRuntimeUrl } from "./browserTextureCache.js";
import { createTextureServiceProvider } from "./textureProviderClient.js";

let manifestPromise = null;

function normalizeManifestMapUrl(value) {
  const source = String(value || "").trim();
  if (!source || /^(?:https?:|data:|blob:|lib:)/i.test(source)) return source;
  return sceneHostAssetUrl(source.replace(/^\/?assets\//, "assets/"));
}

export async function loadSceneTextureManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(sceneHostAssetUrl("assets/textures/manifest.json"))
      .then((response) => response.ok ? response.json() : [])
      .then((entries) => (Array.isArray(entries) ? entries : []).map((entry) => ({
        ...entry,
        url: normalizeManifestMapUrl(entry.url),
        maps: Object.fromEntries(Object.entries(entry.maps || {}).map(([slot, value]) => [slot, normalizeManifestMapUrl(value)]))
      })))
      .catch(() => []);
  }
  return manifestPromise;
}

export function findChangedTextureObjectIds(previousScene, nextScene) {
  const signatureMap = (scene) => {
    const result = new Map();
    for (const slot of listMaterialTextureSlots(scene)) {
      if (!slot.threeJsonId) continue;
      let record = result.get(slot.threeJsonId);
      if (!record) {
        record = [];
        result.set(slot.threeJsonId, record);
      }
      record.push({
        materialPointer: slot.relativeMaterialPointer,
        slot: slot.slot,
        // Material changes include color/PBR scalars as well as URL fields. Repeating the same
        // material object for each slot is harmless after serialization and keeps this helper
        // independent from descriptor-shape assumptions.
        material: slot.material || {}
      });
    }
    return new Map(Array.from(result, ([id, records]) => [id, JSON.stringify(records)]));
  };
  const before = signatureMap(previousScene);
  const after = signatureMap(nextScene);
  return new Set(Array.from(after, ([id, signature]) => id).filter((id) => before.get(id) !== after.get(id)));
}

/** Host-level orchestration: the scene is already visible when this starts. Service failures are
 * converted to an ordinary texture result and never reject scene generation. */
export async function runHostSceneTexturePipeline(options = {}) {
  const scene = options.scene;
  if (!scene || options.enabled === false) {
    return { scene, assignments: [], taskResults: [], skipped: "disabled" };
  }
  const serviceProvider = createTextureServiceProvider(options.textureService || {});
  const provider = serviceProvider || new TextureAcquisitionProvider();
  try {
    return await runSceneTexturePipeline(scene, {
      mutate: true,
      runtime: options.runtime,
      prompt: options.prompt,
      planner: createSceneTexturePlanner(options.aiProviderOptions || {}),
      textureProvider: provider,
      manifest: await loadSceneTextureManifest(),
      strategy: options.strategy || "semantic-hybrid",
      pbr: options.pbr !== false,
      allowUnknownLicense: options.allowUnknownLicense === true,
      persistenceMode: options.persistenceMode || "remote",
      changedObjectIds: options.changedObjectIds,
      concurrency: options.concurrency ?? 3,
      signal: options.signal,
      revision: options.revision,
      isCurrent: options.isCurrent,
      onProgress: options.onProgress,
      onAssignment: options.onAssignment,
      applyAssignment: options.applyAssignment,
      resolveRuntimeUrl: (authoritativeUrl, assignment, slot) => resolveTextureRuntimeUrl(
        authoritativeUrl,
        assignment?.candidate?.runtimeMaps?.[slot] || authoritativeUrl,
        { enabled: options.cache !== false, signal: options.signal, source: assignment?.candidate?.source }
      )
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn("[scene texture pipeline] skipped after service/planning failure:", error);
    options.onProgress?.({ phase: "failed", error });
    return { scene, assignments: [], taskResults: [], error, skipped: "pipeline_failed" };
  }
}

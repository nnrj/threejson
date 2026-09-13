import { getByPointer, setByPointer } from "../util/jsonPointer.js";
import {
  MATERIAL_TEXTURE_SLOT_NAMES,
  groupMaterialTextureSlots,
  listMaterialTextureSlots
} from "./textureSlots.js";
import { asTextureAcquisitionProvider } from "./textureProvider.js";
import { applyTextureAssignmentAsync } from "./runtimeTextureAssignment.js";
import { createTextureAssignmentMaterial } from "./textureAssignmentData.js";

const GENERATION_KINDS = new Set(["image", "seamless", "spherical", "pbr-set", "pbr-derive"]);
const SOURCE_PREFERENCES = new Set(["auto", "manifest", "search", "pbr-library", "generate"]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Texture pipeline aborted.", "AbortError");
}

function normalizeString(value, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function tokenize(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function containsUrl(value) {
  if (typeof value === "string") return /(?:https?:\/\/|data:|blob:|lib:\/\/)/i.test(value);
  if (Array.isArray(value)) return value.some(containsUrl);
  if (value && typeof value === "object") return Object.values(value).some(containsUrl);
  return false;
}

function normalizeTask(raw, materialByPointer, index) {
  if (!raw || typeof raw !== "object" || containsUrl(raw)) return null;
  const materialPointer = normalizeString(raw.materialPointer);
  const material = materialByPointer.get(materialPointer);
  if (!material) return null;
  const requestedSlots = Array.isArray(raw.slots) ? raw.slots : [raw.slot || "baseColor"];
  const slots = Array.from(new Set(requestedSlots.filter((slot) => MATERIAL_TEXTURE_SLOT_NAMES.includes(slot))));
  if (!slots.length) return null;
  const query = normalizeString(raw.query || raw.description || raw.semanticNeed);
  if (!query) return null;
  const generationKind = GENERATION_KINDS.has(raw.generationKind) ? raw.generationKind : null;
  const sourcePreference = SOURCE_PREFERENCES.has(raw.sourcePreference) ? raw.sourcePreference : "auto";
  return {
    id: normalizeString(raw.id, `texture-task-${index + 1}`),
    materialPointer,
    relativeMaterialPointer: material.relativeMaterialPointer,
    objectPointer: material.objectPointer,
    threeJsonId: material.threeJsonId,
    objectName: material.objectName,
    slots,
    query,
    reason: normalizeString(raw.reason),
    sourcePreference,
    generationKind,
    tileable: raw.tileable === true,
    projection: raw.projection === "equirectangular" ? "equirectangular" : "uv",
    overwrite: raw.overwrite === true
  };
}

function normalizePlannerResponse(value) {
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(cleaned);
  }
  return value;
}

/**
 * Make exactly one host-supplied LLM planning call. The returned plan is semantic-only: any task
 * containing a URL is discarded instead of allowing a model to fabricate network resources.
 */
export async function planSceneTextures(scene, prompt, options = {}) {
  if (!scene || typeof scene !== "object") throw new TypeError("planSceneTextures requires a scene object.");
  const slots = listMaterialTextureSlots(scene, {
    changedObjectIds: options.changedObjectIds
  });
  const materials = groupMaterialTextureSlots(slots);
  if (!materials.length) return { tasks: [], materials, slots };
  if (typeof options.planner !== "function") {
    return { tasks: [], materials, slots, skipped: "planner_not_configured" };
  }
  checkAbort(options.signal);
  const raw = await options.planner({
    prompt: String(prompt || ""),
    materials: materials.map(({ populatedSlots, ...material }) => ({
      ...material,
      populatedSlots: Object.keys(populatedSlots)
    })),
    policy: {
      strategy: options.strategy || "semantic-hybrid",
      pbr: options.pbr !== false,
      preserveExisting: options.preserveExisting !== false,
      semanticOnly: true
    },
    signal: options.signal
  });
  checkAbort(options.signal);
  const parsed = normalizePlannerResponse(raw) || {};
  const materialByPointer = new Map(materials.map((material) => [material.materialPointer, material]));
  const forcedSource = ["manifest", "search", "generate"].includes(options.strategy)
    ? options.strategy
    : null;
  const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
    .map((task, index) => normalizeTask(task, materialByPointer, index))
    .filter(Boolean)
    .map((task) => ({
      ...task,
      sourcePreference: forcedSource || task.sourcePreference,
      slots: options.pbr === false ? task.slots.filter((slot) => slot === "baseColor") : task.slots
    }))
    .filter((task) => task.slots.length > 0)
    .filter((task) => task.overwrite || task.slots.some((slotName) => {
      const material = materialByPointer.get(task.materialPointer);
      return !material?.populatedSlots?.[slotName];
    }));
  return { tasks, materials, slots };
}

function manifestScore(entry, task) {
  const haystack = tokenize([
    entry?.id,
    entry?.name,
    entry?.description,
    ...(Array.isArray(entry?.keywords) ? entry.keywords : []),
    ...(Array.isArray(entry?.tags) ? entry.tags : [])
  ].join(" "));
  const query = tokenize(`${task.query} ${task.objectName || ""}`);
  let score = 0;
  for (const token of query) if (haystack.has(token)) score += 2;
  const provided = new Set(Object.keys(entry?.maps || {}));
  for (const slot of task.slots) if (provided.has(slot)) score += 1;
  if (task.tileable && entry?.tileable === true) score += 2;
  if (task.projection === "equirectangular" && entry?.projection === "equirectangular") score += 3;
  return score;
}

function candidateFromManifest(task, manifest) {
  let best = null;
  let bestScore = 0;
  for (const entry of Array.isArray(manifest) ? manifest : []) {
    const score = manifestScore(entry, task);
    if (score <= bestScore) continue;
    bestScore = score;
    best = entry;
  }
  if (!best || bestScore < 2) return null;
  const maps = candidateMaps(best);
  // A bundled result only wins the first acquisition tier when it can satisfy the complete
  // semantic task. Otherwise let a search/PBR provider supply the missing maps as one set.
  if (!task.slots.every((slot) => typeof maps[slot] === "string" && maps[slot].trim())) return null;
  return {
    id: best.id,
    source: "threejson-assets",
    name: best.name,
    url: best.url || best.maps?.baseColor || null,
    maps: { ...(best.maps || {}) },
    tileable: best.tileable === true,
    projection: best.projection || "uv",
    license: best.license || { status: "known", id: "MIT" },
    attribution: best.attribution || null,
    score: bestScore
  };
}

function licenseIsKnown(candidate) {
  const license = candidate?.license;
  if (typeof license === "string") return Boolean(license.trim());
  if (!license || typeof license !== "object") return false;
  if (license.status === "unknown") return false;
  // A status label alone is not evidence of a usable license. Requiring concrete metadata keeps a
  // custom/provider response such as `{ status: "known" }` behind the host confirmation gate.
  return Boolean(license.id || license.name || license.url);
}

function selectCandidate(candidates, allowUnknownLicense) {
  const list = Array.isArray(candidates) ? candidates : [];
  return list.find((candidate) => allowUnknownLicense || licenseIsKnown(candidate)) || null;
}

function candidateMaps(candidate) {
  const maps = candidate?.maps && typeof candidate.maps === "object" ? { ...candidate.maps } : {};
  if (!maps.baseColor && typeof candidate?.url === "string") maps.baseColor = candidate.url;
  return maps;
}

function canGenerate(capabilities, kind) {
  const supported = new Set([...(capabilities.generate || []), ...(capabilities.generationKinds || [])]);
  return supported.has(kind);
}

function chooseGenerationKind(task, capabilities) {
  if (task.generationKind) return task.generationKind;
  const wantsPbrSet = task.slots.some((slot) => slot !== "baseColor");
  if (wantsPbrSet && canGenerate(capabilities, "pbr-set")) return "pbr-set";
  if (wantsPbrSet && canGenerate(capabilities, "pbr-derive")) return "pbr-derive";
  if (task.tileable) return "seamless";
  if (task.projection === "equirectangular") return "spherical";
  return "image";
}

function constrainGeneratedCandidate(candidate, kind) {
  if (!candidate || kind === "pbr-set" || kind === "pbr-derive") return candidate;
  const maps = candidateMaps(candidate);
  const baseColor = maps.baseColor;
  return {
    ...candidate,
    maps: baseColor ? { baseColor } : {},
    url: typeof candidate.url === "string" ? candidate.url : baseColor || null,
    generationKind: kind
  };
}

async function acquireCandidate(task, context) {
  const { provider, capabilities, manifest, allowUnknownLicense, signal } = context;
  const preferGenerate = task.sourcePreference === "generate";
  const skipManifest = preferGenerate || task.sourcePreference === "search";
  if (!skipManifest) {
    const bundled = candidateFromManifest(task, manifest);
    if (bundled && (allowUnknownLicense || licenseIsKnown(bundled))) return bundled;
    if (task.sourcePreference === "manifest") return null;
  }

  if (!preferGenerate && capabilities.search.length) {
    checkAbort(signal);
    const searched = await provider.search({
      query: task.query,
      slots: task.slots,
      kind: task.sourcePreference === "pbr-library" ? "pbr" : "mixed",
      tileable: task.tileable,
      projection: task.projection,
      limit: context.searchLimit || 6
    }, { signal });
    const candidate = selectCandidate(searched.candidates, allowUnknownLicense);
    if (candidate) return candidate;
    const unknown = searched.candidates?.[0];
    if (unknown && !licenseIsKnown(unknown)) return { ...unknown, blockedByLicense: true };
  }

  const kind = chooseGenerationKind(task, capabilities);
  if (canGenerate(capabilities, kind)) {
    checkAbort(signal);
    const generated = await provider.generate({
      prompt: task.query,
      slots: task.slots,
      kind,
      tileable: task.tileable,
      projection: task.projection
    }, { signal });
    const selected = selectCandidate(generated.candidates, allowUnknownLicense);
    if (selected) return constrainGeneratedCandidate(selected, kind);
    const unknown = generated.candidates?.[0];
    return unknown
      ? { ...constrainGeneratedCandidate(unknown, kind), blockedByLicense: true }
      : null;
  }
  return null;
}

function setAssignmentOnScene(scene, assignment) {
  const currentMaterial = assignment.materialPointer
    ? getByPointer(scene, assignment.materialPointer)
    : null;
  if (!currentMaterial || typeof currentMaterial !== "object") {
    throw new Error(`Texture material not found at ${assignment.materialPointer || "unknown"}.`);
  }
  const material = createTextureAssignmentMaterial(currentMaterial, assignment);
  // Replace the fully prepared material in one pointer write. No partially updated authoritative
  // descriptor can escape if validation or field preparation above fails.
  setByPointer(scene, assignment.materialPointer, material);
  for (const [slot, source] of Object.entries(assignment.maps || {})) {
    const slotInfo = assignment.slotRecords?.[slot];
    if (!slotInfo || typeof source !== "string" || !source.trim()) continue;
    slotInfo.currentUrl = source.trim();
    slotInfo.material = material;
  }
  return material;
}

async function runWithConcurrency(items, limit, worker) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(Math.max(1, limit), queue.length || 1) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(workers);
}

function groupTasksByMaterial(tasks) {
  const groups = [];
  const byMaterial = new Map();
  for (const task of tasks) {
    const key = typeof task?.materialPointer === "string" && task.materialPointer
      ? task.materialPointer
      : `__task_${groups.length}`;
    let group = byMaterial.get(key);
    if (!group) {
      group = [];
      byMaterial.set(key, group);
      groups.push(group);
    }
    group.push(task);
  }
  return groups;
}

function emitProgress(callback, event) {
  if (typeof callback !== "function") return;
  try { callback(event); } catch (_) { /* host progress must never break acquisition */ }
}

/**
 * Acquire and progressively apply textures. Provider or individual slot failures are returned as
 * task results and never turn a valid scene into a failed scene.
 */
export async function runSceneTexturePipeline(scene, options = {}) {
  if (!scene || typeof scene !== "object") throw new TypeError("runSceneTexturePipeline requires a scene object.");
  const provider = asTextureAcquisitionProvider(options.textureProvider);
  const outputScene = options.mutate === true ? scene : cloneJson(scene);
  if (!provider) {
    return { scene: outputScene, assignments: [], pendingLicense: [], taskResults: [], skipped: "provider_not_configured" };
  }
  checkAbort(options.signal);
  let capabilities;
  let capabilitiesError = null;
  try {
    capabilities = await provider.capabilities({ signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    capabilitiesError = error;
    capabilities = { search: [], generate: [], generationKinds: [], persist: [], pbr: [] };
  }
  const plan = options.plan || await planSceneTextures(outputScene, options.prompt || "", {
    planner: options.planner,
    signal: options.signal,
    strategy: options.strategy,
    pbr: options.pbr,
    changedObjectIds: options.changedObjectIds
  });
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const slots = listMaterialTextureSlots(outputScene, { changedObjectIds: options.changedObjectIds });
  const slotByMaterial = new Map();
  for (const slot of slots) {
    if (!slotByMaterial.has(slot.materialPointer)) slotByMaterial.set(slot.materialPointer, {});
    slotByMaterial.get(slot.materialPointer)[slot.slot] = slot;
  }
  const assignments = [];
  const pendingLicense = [];
  const taskResults = [];
  const allowUnknownLicense = options.allowUnknownLicense === true
    && capabilities.licensePolicy !== "known-only";
  let completed = 0;
  emitProgress(options.onProgress, { phase: "planned", total: tasks.length, completed: 0 });

  // Different materials can progress concurrently, while tasks targeting the same material run in
  // planner order. This prevents two valid semantic needs from racing an atomic material update.
  await runWithConcurrency(groupTasksByMaterial(tasks), options.concurrency ?? 3, async (taskGroup) => {
    for (const task of taskGroup) {
      const result = { task, ok: false };
      try {
        checkAbort(options.signal);
        if (typeof options.isCurrent === "function" && !options.isCurrent(options.revision)) {
          result.skipped = "stale";
          continue;
        }
        emitProgress(options.onProgress, { phase: "acquiring", task, total: tasks.length, completed });
        let candidate = await acquireCandidate(task, {
          provider,
          capabilities,
          manifest: options.manifest,
          allowUnknownLicense,
          signal: options.signal,
          searchLimit: options.searchLimit
        });
        if (!candidate) {
          result.skipped = "no_candidate";
          continue;
        }
        if (candidate.blockedByLicense || (!licenseIsKnown(candidate) && !allowUnknownLicense)) {
          pendingLicense.push({ task, candidate });
          result.skipped = "license_confirmation_required";
          continue;
        }
        if (candidate.source !== "threejson-assets" && capabilities.persist.length) {
          try {
            const persisted = await provider.persist({
              mode: options.persistenceMode || "remote",
              candidates: [candidate]
            }, { signal: options.signal });
            candidate = persisted.candidates?.[0] || candidate;
          } catch (error) {
            if (options.signal?.aborted) throw error;
            // Persistence/proxying is an optimization. Keep the authoritative candidate URL and
            // let runtime preload decide whether the original source itself is usable.
            result.persistWarning = String(error?.message || error);
          }
        }
        const availableMaps = candidateMaps(candidate);
        const maps = {};
        const slotRecords = slotByMaterial.get(task.materialPointer) || {};
        for (const slot of task.slots) {
          const source = availableMaps[slot];
          const record = slotRecords[slot];
          if (!record || (!task.overwrite && record.currentUrl) || typeof source !== "string" || !source.trim()) continue;
          maps[slot] = source.trim();
        }
        if (!Object.keys(maps).length) {
          result.skipped = "candidate_has_no_requested_maps";
          continue;
        }
        const assignment = {
          id: task.id,
          task,
          threeJsonId: task.threeJsonId,
          objectPointer: task.objectPointer,
          materialPointer: task.materialPointer,
          relativeMaterialPointer: task.relativeMaterialPointer,
          maps,
          slotRecords,
          candidate,
          revision: options.revision
        };
        if (options.runtime) {
          await (options.applyAssignment || applyTextureAssignmentAsync)(options.runtime, assignment, {
            signal: options.signal,
            isCurrent: options.isCurrent,
            loadTexture: options.loadTexture,
            resolveRuntimeUrl: options.resolveRuntimeUrl,
            sceneRevision: options.revision,
            commitSceneAssignment: () => setAssignmentOnScene(outputScene, assignment)
          });
        } else {
          setAssignmentOnScene(outputScene, assignment);
        }
        assignments.push(assignment);
        result.ok = true;
        result.assignment = assignment;
        if (typeof options.onAssignment === "function") {
          try {
            await options.onAssignment(assignment, outputScene);
          } catch (error) {
            result.hostWarning = String(error?.message || error);
          }
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        result.error = String(error?.message || error);
      } finally {
        completed += 1;
        taskResults.push(result);
        emitProgress(options.onProgress, {
          phase: "task-complete",
          task,
          result,
          total: tasks.length,
          completed
        });
      }
    }
  });
  emitProgress(options.onProgress, {
    phase: "complete",
    total: tasks.length,
    completed,
    assignments: assignments.length,
    pendingLicense: pendingLicense.length,
    pendingLicenseItems: pendingLicense.map(({ task, candidate }) => ({
      taskId: task?.id || null,
      objectName: task?.objectName || null,
      query: task?.query || null,
      candidateId: candidate?.id || null,
      candidateName: candidate?.name || null,
      source: candidate?.source || null,
      license: candidate?.license || { status: "unknown" }
    }))
  });
  return { scene: outputScene, assignments, pendingLicense, taskResults, capabilities, capabilitiesError, plan };
}

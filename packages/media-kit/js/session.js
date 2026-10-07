import { validateTimeline, getTimelineDuration } from "threejson/timeline";
import { createSceneSession, captureSceneSession, createSceneOperationService } from "threejson/session";
import { validateMediaDocument } from "./documents.js";
import { applyMediaEditing, editMediaRecordAutomation, isMediaSource, mediaAssetOf, putClipScene, validateMediaEditing, laneEnabled, itemEnabled } from "./editing.js";

const error = (code, message) => Object.assign(new Error(message), { code });
const fail = (code, message) => { throw error(code, message); };
const freeze = (value) => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const validId = (id) => typeof id === "string" && id.trim() && !["__proto__", "constructor", "prototype"].includes(id);
const blankScene = () => ({ version: "next", sceneConfig: { scene: { background: "#050812" }, camera: { position: { x: 0, y: 2, z: 10 } }, controls: { type: "none" } }, objectList: [], timeline: { version: 1, tracks: [] } });
const defaultDocument = () => ({ documentType: "composition", compositionVersion: 1, output: { width: 1920, height: 1080, fps: 30 }, scenes: {}, timeline: { version: 1, clips: [] }, production: { version: 1, state: "planning", shots: {} } });
const sceneOf = (document, id) => {
  const clip = document.timeline.clips.find(item => item.id === id);
  if (!clip) fail("MEDIA_SHOT_MISSING", `Shot not found: ${id}`);
  if (isMediaSource(clip.source)) fail("MEDIA_NOT_SCENE", "This clip is an imported image/video, not an editable 3D scene.");
  const scene = typeof clip.source === "string" ? document.scenes?.[clip.source] : clip.source;
  if (!scene) fail("MEDIA_EXTERNAL_SHOT", "Resolve an external shot to an embedded scene before editing it.");
  return { clip, scene };
};

// Structural evidence only, not a claim that the camera sees these objects. Keep
// extension/native types eligible; camera, light and renderer records alone are
// not a produced shot. Captions and deliberate blank intervals are valid media.
function sceneContent(scene, metadata = {}) {
  let visualObjects = 0;
  const visit = record => {
    if (!record || typeof record !== "object") return;
    const type = String(record.objType || "").toLowerCase();
    if (type && !["group", "scene", "camera", "renderer", "controls", "renderloop", "light", "ambientlight", "directionallight", "pointlight", "spotlight", "hemispherelight", "audio"].includes(type)) visualObjects++;
    for (const child of record.children || []) visit(child);
  };
  (scene?.objectList || []).forEach(visit);
  // Friendly records are canonicalized by shot.put. Imported friendly scenes
  // remain eligible without forcing a runtime or geometry build for inspection.
  for (const [key, records] of Object.entries(scene?.worldInfo || {})) if (Array.isArray(records) && !/light|camera|control|pass|audio/i.test(key)) visualObjects += records.length;
  const captions = (scene?.timeline?.captions || []).filter(item => item.enabled !== false && String(item.text || "").trim()).length;
  const animatedBackground = scene?.timeline?.tracks?.some(track => track.target === "$scene" && track.property.startsWith("background"));
  return { visualObjects, captions, audio: (scene?.timeline?.audio || []).filter(item => item.enabled !== false).length,
    hasContent: visualObjects > 0 || captions > 0 || animatedBackground === true || metadata.intentionalBlank === true };
}

export function inspectMediaDocument(document, revision = 0) {
  return { revision, duration: getTimelineDuration(document.timeline), output: document.output, state: document.production?.state,
    shots: (document.timeline.clips || []).map(clip => {
      const scene = typeof clip.source === "string" ? document.scenes?.[clip.source] : clip.source;
      const asset = mediaAssetOf(document, clip);
      const content = asset ? { hasContent: true, kind: asset.kind, assetId: clip.source.assetId } : sceneContent(scene, document.production?.shots?.[clip.id]);
      const overlay = document.timeline.captions?.some(item => itemEnabled(document.timeline, item) && String(item.text || "").trim() && (item.start || 0) < (clip.start || 0) + clip.duration && (item.start || 0) + (item.duration || 0) > (clip.start || 0));
      return { ...document.production?.shots?.[clip.id], ...content, hasContent: content.hasContent || overlay === true, id: clip.id, enabled: laneEnabled(document.timeline, clip), start: clip.start || 0, duration: clip.duration, sourceStart: clip.sourceStart || 0, rate: clip.rate ?? 1,
        objects: scene?.objectList?.length, tracks: scene?.timeline?.tracks?.length || 0, effects: scene?.timeline?.effects?.length || 0 };
    }) };
}

export function diagnoseMediaDocument(document) {
  const diagnostics = [], clips = document.timeline.clips || [];
  const add = (code, message, shotId, severity = "error") => diagnostics.push({ code, message, shotId, severity });
  if (!clips.some(c => laneEnabled(document.timeline, c))) add("MEDIA_NO_SHOTS", "The project has no enabled shots.");
  for (const clip of clips) {
    if (!laneEnabled(document.timeline, clip)) continue;
    if (isMediaSource(clip.source)) { if (!mediaAssetOf(document, clip)) add("MEDIA_ASSET_MISSING", "Referenced media asset is missing.", clip.id); continue; }
    let scene;
    try { scene = sceneOf(document, clip.id).scene; validateMediaDocument(scene); }
    catch (e) { add(e.code || "MEDIA_SCENE_INVALID", e.message, clip.id); continue; }
    if (document.production?.shots?.[clip.id]?.stage === "planned") add("MEDIA_SHOT_UNBUILT", "Storyboard shot has not been produced.", clip.id);
    const metadata = document.production?.shots?.[clip.id];
    const overlay = document.timeline.captions?.some(item => itemEnabled(document.timeline, item) && String(item.text || "").trim() && (item.start || 0) < (clip.start || 0) + clip.duration && (item.start || 0) + (item.duration || 0) > (clip.start || 0));
    if (!sceneContent(scene, metadata).hasContent && !overlay) add("MEDIA_SHOT_EMPTY", "Shot has no visual objects or captions. Produce its content; use metadata.intentionalBlank only for an intentionally blank interval.", clip.id);
    const ids = new Set(["$camera", "$scene", "$renderer"]);
    const visit = (record) => { if (!record || typeof record !== "object") return; if (record.threeJsonId) ids.add(record.threeJsonId); if (record.objType === "pass") ids.add(`$pass:${record.id || record.threeJsonId}`); for (const child of record.children || []) visit(child); };
    (scene.objectList || []).forEach(visit);
    for (const [key, prefix] of [["effects", "$effect:"], ["captions", "$caption:"], ["audio", "$audio:"]]) for (const item of scene.timeline?.[key] || []) ids.add(prefix + item.id);
    for (const item of [...(scene.timeline?.tracks || []), ...(scene.timeline?.effects || [])]) if (!ids.has(item.target)) add("TIMELINE_TARGET_MISSING", `Target ${item.target} is not in this shot.`, clip.id);
    if (!(scene.timeline?.tracks?.length || scene.timeline?.effects?.length || scene.timeline?.audio?.length)) add("MEDIA_STATIC_SHOT", "No timeline motion or audio in this shot; verify this is intentional.", clip.id, "warning");
  }
  const sorted = clips.filter(c => laneEnabled(document.timeline, c)).toSorted((a, b) => (a.start || 0) - (b.start || 0));
  let end = 0;
  for (const clip of sorted) { if ((clip.start || 0) > end + 1e-6) add("MEDIA_GAP", `Blank interval ${end}–${clip.start}s.`, clip.id, "warning"); end = Math.max(end, (clip.start || 0) + clip.duration); }
  if (document.timeline.duration !== undefined && end > document.timeline.duration + 1e-6) add("MEDIA_CLIPS_EXCEED_DURATION", "Shots extend beyond the declared film duration; explicitly retime or trim them.");
  if (document.timeline.duration > end + 1e-6) add("MEDIA_GAP", `Blank final interval ${end}–${document.timeline.duration}s.`, undefined, "warning");
  return { satisfied: !diagnostics.some(d => d.severity === "error"), diagnostics, checks: { structure: diagnostics.some(d => d.severity === "error") ? "failed" : "passed", resources: "unchecked", render: "unchecked", narrative: "unchecked" } };
}

/** Authoring project, not a renderer. Unchanged shot scenes are structurally shared.
 * Scene edits delegate to the existing SceneSession command transaction machinery.
 */
export function createMediaProjectSession(input, options = {}) {
  let document = input ? validateMediaDocument(input) : defaultDocument();
  if (document.documentType !== "composition") {
    const scene = document, duration = Math.max(getTimelineDuration(scene.timeline), options.duration || 0);
    if (!(duration > 0)) fail("MEDIA_DURATION_REQUIRED", "A scene needs an explicit positive duration to become a project.");
    document = { ...defaultDocument(), output: scene.output || defaultDocument().output, scenes: { scene }, timeline: { version: 1, clips: [{ id: "scene", source: "scene", duration }] } };
  }
  document = freeze(document);
  let revision = 0, disposed = false, queue = Promise.resolve();
  const listeners = new Set(), undo = [], redo = [];
  const enqueue = (fn) => { const task = queue.then(() => { if (disposed) fail("MEDIA_SESSION_DISPOSED", "Project session is disposed."); return fn(); }); queue = task.catch(() => {}); return task; };
  const publish = (next, before, label) => {
    document = freeze(next); revision++;
    const event = { document, previousDocument: before, revision, label };
    for (const listener of listeners) { try { listener(event); } catch (e) { try { options.onError?.(e); } catch { /* observers cannot invalidate a committed transaction */ } } }
    return event;
  };
  const assertRevision = (args) => { args.signal?.throwIfAborted(); if (disposed) fail("MEDIA_SESSION_DISPOSED", "Project session is disposed."); if (args.baseRevision != null && args.baseRevision !== revision) fail("STALE_MEDIA_REVISION", `Expected project revision ${revision}, received ${args.baseRevision}.`); };
  return {
    get document() { return document; }, get revision() { return revision; }, get disposed() { return disposed; },
    get canUndo() { return undo.length > 0; }, get canRedo() { return redo.length > 0; },
    snapshot() { return document; }, inspect() { return inspectMediaDocument(document, revision); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispatch(commands, args = {}) {
      const captured = structuredClone(Array.isArray(commands) ? commands : [commands]);
      return enqueue(async () => {
        assertRevision(args);
        const before = document;
        let draft = { ...before, scenes: { ...before.scenes }, timeline: { ...before.timeline, clips: [...before.timeline.clips] }, production: { ...before.production, version: 1, shots: { ...before.production?.shots } } };
        if (draft.production.state === "complete") draft.production.state = "producing";
        for (const { op, args: a = {} } of captured) {
          args.signal?.throwIfAborted();
          const locked = item => item && draft.timeline.lanes?.some(l => l.id === item.laneId && l.locked);
          if ((op.startsWith("media.shot.") || op === "timeline.edit" && a.shotId) && locked(draft.timeline.clips.find(c => c.id === (a.shotId || a.id)))) fail("MEDIA_LANE_LOCKED", "The target track is locked.");
          if (op === "timeline.edit" && !a.shotId) {
            const changed = new Set([...(a.remove || []), ...(a.upsert || []).map(i => i.id)]);
            if ((draft.timeline[a.section] || []).some(i => changed.has(i.id) && locked(i)) || (a.upsert || []).some(locked)) fail("MEDIA_LANE_LOCKED", "The target track is locked.");
          }
          if (op === "media.document.replace") {
            const replacement = validateMediaDocument(a.document);
            if (replacement.documentType !== "composition") fail("MEDIA_COMPOSITION_REQUIRED", "Project JSON must be a composition.");
            draft = { ...replacement, scenes: { ...replacement.scenes }, production: { ...replacement.production, shots: { ...replacement.production?.shots } } };
            for (const scene of Object.values(draft.scenes)) {
              validateMediaDocument(scene);
              const check = createSceneSession(scene); check.dispose();
            }
          } else if (applyMediaEditing(draft, op, a)) {
            // The session owns validation, revision checking and atomic history.
          } else if (op === "media.plan.set") {
            if (!Array.isArray(a.shots) || !a.shots.length) fail("INVALID_MEDIA_PLAN", "Plan needs shots with id, title and duration.");
            if (draft.timeline.clips.length) fail("MEDIA_PLAN_EXISTS", "Edit individual shots to preserve completed work; do not replace the entire project plan.");
            let start = 0;
            for (const shot of a.shots) {
              if (!validId(shot.id) || draft.scenes[shot.id]) fail("INVALID_MEDIA_SHOT_ID", "Shot id must be unique.");
              const duration = shot.duration;
              if (!(Number.isFinite(duration) && duration > 0)) fail("INVALID_MEDIA_DURATION", "Shot duration must be positive.");
              draft.timeline.clips.push({ id: shot.id, source: shot.id, start, duration }); start += duration;
              draft.scenes[shot.id] = blankScene();
              draft.production.shots[shot.id] = { title: shot.title || shot.id, intent: shot.intent || "", narration: shot.narration || "", stage: "planned" };
            }
            draft.production.brief = a.brief || ""; draft.production.state = "storyboard";
          } else if (op === "media.shot.put") {
            if (!validId(a.id)) fail("INVALID_MEDIA_SHOT_ID", "Shot needs a valid id.");
            const existing = draft.timeline.clips.find(c => c.id === a.id);
            let clip = { ...existing, ...a.clip, id: a.id, source: existing?.source || a.id };
            if (!existing && a.scene === undefined) fail("MEDIA_SCENE_REQUIRED", "A new shot needs a scene.");
            const scene = a.scene === undefined ? sceneOf(draft, a.id).scene : validateMediaDocument(a.scene);
            if (scene.documentType === "composition") fail("MEDIA_NESTED_COMPOSITION", "A shot must be a scene, not another composition.");
            // Canonicalize through the engine's authoring adapter before acceptance.
            const session = createSceneSession(scene);
            let canonical;
            try { canonical = { ...captureSceneSession(session), timeline: scene.timeline || { version: 1 }, ...(scene.output ? { output: scene.output } : {}) }; }
            finally { session.dispose(); }
            if (existing) {
              if (a.clip) {
                const declaredDuration = draft.timeline.duration;
                applyMediaEditing(draft, "media.clip.update", { id: a.id, changes: a.clip });
                // Agent shot updates do not implicitly revise its declared film
                // length. Diagnose clipping until it explicitly retimes the film.
                if (declaredDuration !== undefined) draft.timeline.duration = declaredDuration;
              }
              clip = draft.timeline.clips.find(c => c.id === a.id);
            } else draft.timeline.clips.push(clip);
            putClipScene(draft, clip, canonical);
            draft.production.shots[a.id] = { ...draft.production.shots[a.id], ...a.metadata, stage: a.metadata?.stage || (a.scene === undefined ? draft.production.shots[a.id]?.stage : "draft") || "draft" };
          } else if (op === "media.shot.remove") {
            applyMediaEditing(draft, "media.clip.remove", a);
          } else if (op === "media.shot.edit") {
            const { scene } = sceneOf(draft, a.id), session = createSceneSession(scene);
            try {
              const receipt = await createSceneOperationService({ session }).execute(a.commands, { signal: args.signal });
              if (!receipt.ok) fail(receipt.code || "MEDIA_SCENE_EDIT_FAILED", receipt.error);
              const edited = captureSceneSession(session);
              putClipScene(draft, sceneOf(draft, a.id).clip, edited);
              if (draft.production.shots[a.id]?.stage === "planned" && sceneContent(edited).hasContent) draft.production.shots[a.id] = { ...draft.production.shots[a.id], stage: "draft" };
            } finally { session.dispose(); }
          } else if (op === "timeline.edit") {
            const allowed = ["tracks", "effects", "captions", "audio"];
            if (!allowed.includes(a.section)) fail("INVALID_TIMELINE_SECTION", "Edit tracks, effects, captions or audio by stable id.");
            const scene = a.shotId ? sceneOf(draft, a.shotId).scene : draft;
            const timeline = { ...scene.timeline }, records = new Map((timeline[a.section] || []).map(item => [item.id, item]));
            for (const id of a.remove || []) { if (!records.delete(id)) fail("TIMELINE_ITEM_MISSING", `Item not found: ${id}`); }
            for (const item of a.upsert || []) records.set(item.id, item);
            timeline[a.section] = [...records.values()];
            if (!a.shotId && ["captions", "audio"].includes(a.section)) {
              // Deleting a target also removes its automation. Retiming remains
              // opt-in for exact JSON upserts; NLE interactions opt in explicitly.
              const owner = { ...draft, timeline };
              for (const item of draft.timeline[a.section] || []) {
                const after = records.get(item.id);
                if (!after || a.retimeAutomation && (a.upsert || []).some(value => value.id === item.id)) editMediaRecordAutomation(owner, a.section, item, after);
              }
            }
            const checked = validateTimeline(timeline);
            if (a.shotId) putClipScene(draft, sceneOf(draft, a.shotId).clip, { ...scene, timeline: checked });
            else draft.timeline = checked;
          } else if (op === "media.duration.set") {
            if (!(Number.isFinite(a.duration) && a.duration > 0)) fail("INVALID_MEDIA_DURATION", "Duration must be positive.");
            const end = Math.max(0, ...draft.timeline.clips.map(c => (c.start || 0) + c.duration));
            if (a.duration < end - 1e-6) fail("MEDIA_CLIPS_EXCEED_DURATION", "Move/trim clips explicitly before shortening the project.");
            draft.timeline.duration = a.duration;
          } else if (op === "media.project.set") {
            if (a.name !== undefined) draft.name = String(a.name);
            if (a.output) draft.output = { ...draft.output, ...a.output };
            if (a.state) { if (!["planning", "storyboard", "producing", "paused", "complete"].includes(a.state)) fail("INVALID_MEDIA_STATE", "Unknown production state."); draft.production.state = a.state; }
          } else fail("UNKNOWN_MEDIA_OPERATION", `Unknown media operation: ${op}`);
        }
        draft.timeline = validateTimeline(draft.timeline);
        validateMediaEditing(draft);
        if (draft.production.state === "complete" && !diagnoseMediaDocument(draft).satisfied) fail("MEDIA_INCOMPLETE", "Unbuilt or invalid shots remain.");
        for (const name of ["width", "height", "fps"]) if (draft.output?.[name] !== undefined && !(Number.isFinite(draft.output[name]) && draft.output[name] > 0)) fail("INVALID_MEDIA_OUTPUT", `${name} must be positive.`);
        await options.prepare?.(freeze(draft), { signal: args.signal, commands: captured });
        args.signal?.throwIfAborted(); if (disposed) fail("MEDIA_SESSION_DISPOSED", "Project session is disposed.");
        undo.push({ before, after: draft }); redo.length = 0;
        if (options.historyLimit && undo.length > options.historyLimit) undo.shift();
        return publish(draft, before, args.label || captured.map(c => c.op).join(", "));
      });
    },
    undo(args = {}) { return enqueue(async () => { assertRevision(args); const entry = undo.at(-1); if (!entry) return { revision, changed: false }; await options.prepare?.(entry.before, { signal: args.signal }); assertRevision(args); undo.pop(); redo.push(entry); return publish(entry.before, document, "undo"); }); },
    redo(args = {}) { return enqueue(async () => { assertRevision(args); const entry = redo.at(-1); if (!entry) return { revision, changed: false }; await options.prepare?.(entry.after, { signal: args.signal }); assertRevision(args); redo.pop(); undo.push(entry); return publish(entry.after, document, "redo"); }); },
    dispose() { disposed = true; listeners.clear(); undo.length = 0; redo.length = 0; }
  };
}

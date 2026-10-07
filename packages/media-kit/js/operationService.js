import { createSceneSession, createSceneOperationService } from "threejson/session";
import { inspectMediaDocument, diagnoseMediaDocument } from "./session.js";
import { createNarrationCommands } from "./narration.js";
import { isMediaSource } from "./editing.js";

const schema = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" }, number = { type: "number" }, object = { type: "object", additionalProperties: true };
const array = (items) => ({ type: "array", items });
const specs = [
  ["media.document.replace", "authoring", "Explicitly apply a validated composition JSON draft. Destructive replacement; prefer scoped editing for normal adjustments.", schema({ document: object }, ["document"])],
  ["media.asset.put", "authoring", "Register an image/video/audio asset, not a clip occurrence. Use an existing supplied URL, never fabricate one.", schema({ id: string, asset: object }, ["id", "asset"])],
  ["media.lanes.set", "authoring", "Set visual/audio/caption editing tracks. These are not property-animation tracks. Preserve referenced track ids.", schema({ lanes: array(object) }, ["lanes"])],
  ["media.clip.insert", "authoring", "Insert a new occurrence of an existing scene or {type:media,assetId} source.", schema({ clip: object }, ["clip"])],
  ["media.item.duplicate", "authoring", "Copy a clip/audio/caption occurrence, preserving linked records and automation. New start defaults to the original end; scene edits remain copy-on-write.", schema({ section: { type: "string", enum: ["clips", "audio", "captions"] }, id: string, newId: string, start: number }, ["section", "id"])],
  ["media.clip.update", "authoring", "Move, trim or retime one occurrence. Timing is seconds. Linked audio/captions follow unless linked:false.", schema({ id: string, changes: object, linked: { type: "boolean" } }, ["id", "changes"])],
  ["media.clip.split", "authoring", "Split at an absolute composition time, preserving scene and audio source offsets.", schema({ id: string, time: number, newId: string }, ["id", "time"])],
  ["media.clip.remove", "authoring", "Delete a clip and its linked records. ripple:true closes the interval across tracks; overlapping or locked tracks reject atomically.", schema({ id: string, ripple: { type: "boolean" } }, ["id"])],
  ["media.clip.roll", "authoring", "Move the cut between two adjacent clips while preserving their total interval.", schema({ id: string, nextId: string, time: number }, ["id", "nextId", "time"])],
  ["media.clip.reorder", "authoring", "Reorder contiguous clips on one track, preserving linked records. Omit beforeId to place last; use clip.update for tracks with gaps/overlaps.", schema({ id: string, beforeId: string }, ["id"])],
  ["media.inspect", "read", "Read compact project, shot stages and exact timing, without dense geometry.", schema()],
  ["media.plan.set", "authoring", "Create the initial storyboard once. Timings live in clips; keep completed shots on later edits.", schema({ brief: string, shots: array(schema({ id: string, title: string, intent: string, narration: string, duration: number }, ["id", "title", "duration"])) }, ["shots"])],
  ["media.shot.put", "authoring", "Add/replace one shot scene or change its timing/metadata; preserve other shots.", schema({ id: string, scene: object, clip: object, metadata: object }, ["id"])],
  ["media.shot.remove", "authoring", "Remove one shot by id (does not silently retime remaining shots).", schema({ id: string }, ["id"])],
  ["media.shot.inspect", "read", "Inspect one shot, optionally its full scene. Prefer compact query for large meshes.", schema({ id: string, includeScene: { type: "boolean" } }, ["id"])],
  ["media.shot.query", "read", "Execute read-only SceneOperation commands in a shot. Runtime capture uses media.captureFrames.", schema({ id: string, commands: array(object) }, ["id", "commands"])],
  ["media.shot.edit", "authoring", "Atomically apply existing SceneOperation authoring commands to one shot.", schema({ id: string, commands: array(object) }, ["id", "commands"])],
  ["timeline.inspect", "read", "Read shot or composition timing, tracks, captions, effects and audio.", schema({ shotId: string })],
  ["timeline.edit", "authoring", "Upsert or remove timeline items by stable ID, atomically; no array index guessing. Set retimeAutomation:true for NLE timing edits to root audio/captions; deletion removes their automation.", schema({ shotId: string, section: { type: "string", enum: ["tracks", "effects", "captions", "audio"] }, upsert: array(object), remove: array(string), retimeAutomation: { type: "boolean" } }, ["section"])],
  ["media.project.set", "authoring", "Set name, output size/fps or production state. Complete is rejected while shots are unbuilt/invalid.", schema({ name: string, output: object, state: string })],
  ["media.duration.set", "authoring", "Set exact project duration; cannot silently cut off existing clips.", schema({ duration: number }, ["duration"])],
  ["media.shot.narrate", "runtime", "Synthesize locally with an installed host producer, then atomically commit durable audio/captions using measured timing. Optional captions has one display text per spoken sentence. Explicit extend:true retimes this shot and shifts later shots.", schema({ id: string, text: string, captions: array(string), speed: number, extend: { type: "boolean" } }, ["id", "text"])],
  ["media.validate", "read", "Validate shot references, timing and completion. Structural pass does not imply visual quality.", schema()],
  ["media.captureFrames", "read", "Render actual timestamped project frames for review. Requires host capture adapter.", schema({ times: array(number), width: number, height: number }, ["times"])],
  ["media.render", "runtime", "Start a host-managed export job, using existing media jobs/encoding APIs.", schema({ format: string, options: object }, ["format"])]
].map(([op, category, summary, inputSchema]) => ({ op, category, summary, inputSchema, targets: ["media-project"], requirements: op === "media.captureFrames" ? ["capture-adapter"] : op === "media.render" ? ["render-adapter"] : op === "media.shot.narrate" ? ["narration-adapter"] : [] }));
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** Transport-neutral operations; AI/CLI/MCP share the same revision and receipts. */
export function createMediaOperationService({ session, adapters = {} } = {}) {
  if (!session?.dispatch) throw new TypeError("A media project session is required.");
  const sessionId = crypto.randomUUID(), requests = new Map(); let queue = Promise.resolve();
  const shot = (id) => {
    const clip = session.document.timeline.clips.find(c => c.id === id);
    if (!clip) fail("MEDIA_SHOT_MISSING", `Shot not found: ${id}`);
    if (isMediaSource(clip.source)) fail("MEDIA_NOT_SCENE", "Imported media has no editable 3D scene. Inspect the project or edit its clip timing instead.");
    const scene = typeof clip.source === "string" ? session.document.scenes?.[clip.source] : clip.source;
    if (!scene) fail("MEDIA_EXTERNAL_SHOT", "Resolve external shot before inspecting it.");
    return { clip, scene };
  };
  const execute = (input, options = {}) => {
    let commands;
    try { commands = structuredClone(Array.isArray(input) ? input : [input]); } catch (e) { return Promise.resolve(failure(e)); }
    const fingerprint = JSON.stringify({ commands, baseRevision: options.baseRevision });
    const previous = requests.get(options.requestId);
    if (previous) return previous.fingerprint === fingerprint ? previous.promise : Promise.resolve(failure({ code: "REQUEST_ID_CONFLICT", message: "Request id already used for different input." }));
    const task = queue.then(async () => {
      const beforeRevision = session.revision;
      try {
        options.signal?.throwIfAborted();
        if (session.disposed) fail("MEDIA_SESSION_DISPOSED", "Project is disposed.");
        if (options.sessionId && options.sessionId !== sessionId) fail("SESSION_ID_MISMATCH", "Request belongs to a different media project.");
        if (options.baseRevision != null && options.baseRevision !== session.revision) fail("STALE_MEDIA_REVISION", "Project changed; inspect before retrying edits.");
        if (!commands.length) fail("EMPTY_COMMAND_BATCH", "At least one command is required.");
        const categories = new Set(commands.map(command => {
          const spec = specs.find(s => s.op === command.op);
          if (!spec) fail("UNKNOWN_MEDIA_OPERATION", `Unknown operation: ${command.op}`);
          const args = command.args || {};
          for (const key of spec.inputSchema.required) if (args[key] === undefined) fail("INVALID_COMMAND_ARGUMENTS", `${command.op} needs ${key}.`);
          for (const key of Object.keys(args)) if (!(key in spec.inputSchema.properties)) fail("INVALID_COMMAND_ARGUMENTS", `Unknown argument ${key}.`);
          return spec.category;
        }));
        if (categories.size !== 1 || categories.has("runtime") && commands.length !== 1) fail("MIXED_MEDIA_BATCH", "Separate reads, atomic authoring edits and runtime jobs.");
        let results;
        if (categories.has("authoring")) {
          await session.dispatch(commands, options);
          results = commands.map(({ op }) => ({ op, ok: true, data: { revision: session.revision } }));
        } else {
          results = [];
          for (const { op, args = {} } of commands) {
            options.signal?.throwIfAborted(); let data;
            if (op === "media.inspect") data = session.inspect();
            else if (op === "media.validate") data = diagnoseMediaDocument(session.document);
            else if (op === "timeline.inspect") data = args.shotId ? shot(args.shotId).scene.timeline || {} : session.document.timeline;
            else if (op === "media.shot.inspect") { const { clip, scene } = shot(args.id); data = { ...inspectMediaDocument(session.document, session.revision).shots.find(s => s.id === clip.id), ...(args.includeScene ? { scene } : {}) }; }
            else if (op === "media.shot.query") {
              const { scene } = shot(args.id), local = createSceneSession(scene);
              try {
                const service = createSceneOperationService({ session: local }), catalog = service.discover().commands;
                if (!Array.isArray(args.commands) || args.commands.some(c => catalog.find(s => s.op === c.op)?.category !== "read")) fail("MEDIA_QUERY_READ_ONLY", "Shot query accepts only read operations.");
                data = await service.execute(args.commands, { signal: options.signal });
                if (!data.ok) fail(data.code || "MEDIA_QUERY_FAILED", data.error || "Shot query failed.");
              } finally { local.dispose(); }
            } else if (op === "media.shot.narrate") {
              if (!adapters.narrate) fail("MEDIA_NARRATION_UNAVAILABLE", "No installed host narration producer. No model is downloaded automatically.");
              const narration = await adapters.narrate(args, { signal: options.signal });
              options.signal?.throwIfAborted();
              const commands = createNarrationCommands(session.snapshot(), args.id, narration, args);
              await session.dispatch(commands, { ...options, baseRevision: beforeRevision });
              data = { id: args.id, duration: narration.duration, cues: narration.cues.length };
            } else if (op === "media.captureFrames") {
              if (!adapters.captureFrames) fail("MEDIA_CAPTURE_UNAVAILABLE", "No host frame capture adapter. Visual quality remains unchecked.");
              if (!Array.isArray(args.times) || !args.times.length || args.times.some(t => !Number.isFinite(t) || t < 0)) fail("INVALID_CAPTURE_TIMES", "Capture needs finite nonnegative times.");
              data = { frames: await adapters.captureFrames(session.snapshot(), args, { signal: options.signal }), kind: "actual-project", revision: session.revision };
            } else if (op === "media.render") {
              if (!adapters.render) fail("MEDIA_RENDER_UNAVAILABLE", "No host render-job adapter.");
              data = await adapters.render(session.snapshot(), args, { signal: options.signal });
            }
            results.push({ op, ok: true, data });
          }
        }
        return { protocolVersion: 1, sessionId, ok: true, status: session.revision !== beforeRevision ? "committed" : "read", beforeRevision, afterRevision: session.revision, revision: session.revision, results, diagnostics: [] };
      } catch (e) { return failure(e, beforeRevision); }
    });
    queue = task.catch(() => {});
    if (options.requestId) requests.set(options.requestId, { fingerprint, promise: task });
    return task;
  };
  function failure(e, beforeRevision = session.revision) { return { protocolVersion: 1, sessionId, ok: false, status: e.name === "AbortError" ? "cancelled" : "failed", beforeRevision, afterRevision: session.revision, revision: session.revision, results: [], code: e.code || "MEDIA_OPERATION_FAILED", error: e.message, diagnostics: [{ code: e.code || "MEDIA_OPERATION_FAILED", message: e.message }] }; }
  return { sessionId, get revision() { return session.revision; }, execute,
    discover() { return { protocolVersion: 1, sessionId, revision: session.revision, commands: structuredClone(specs), capabilities: { media: true, capture: Boolean(adapters.captureFrames), render: Boolean(adapters.render), narration: Boolean(adapters.narrate) } }; }
  };
}

import { cloneDocumentData, freezeDocumentData, indexSceneDocument, documentError } from "./sceneDocument.js";
import { commitSceneSessionCommands } from "./sceneCommandPlan.js";
import { defaultSceneOperationRegistry } from "../command/operationRegistry.js";
import { parseCommandLine, parseCommandScript } from "../command/parser.js";

export const SCENE_OPERATION_PROTOCOL_VERSION = 1;
const states = new WeakMap();
const canonical = (value) => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);
function stateFor(session) {
  let state = states.get(session);
  if (!state) {
    state = { id: globalThis.crypto.randomUUID(), requests: new Map(), queue: Promise.resolve(), initialRevision: session.revision, changed: new Map(), removed: new Map() };
    session.subscribe((event) => {
      const before = event.previousDocument, after = event.document;
      const index = indexSceneDocument(after), changed = new Set(changes(before, after));
      if (before.root.design !== after.root.design) for (const id of index.keys()) changed.add(id);
      for (const entry of index.values()) {
        let parent = entry.parentId;
        while (parent) { if (changed.has(parent)) { changed.add(entry.id); break; } parent = index.get(parent)?.parentId; }
      }
      for (const id of changed) {
        state.changed.set(id, after.revision);
        if (index.has(id)) state.removed.delete(id); else state.removed.set(id, after.revision);
      }
    });
    states.set(session, state);
  }
  return state;
}
function changes(before, after) {
  if (before === after) return [];
  const a = indexSceneDocument(before), b = indexSceneDocument(after);
  return [...new Set([...a.keys(), ...b.keys()])].filter((id) => a.get(id)?.record !== b.get(id)?.record);
}
function coverage(runtimePrepared = false) {
  return { arguments: "passed", references: "passed", structure: "passed", geometry: runtimePrepared ? "passed" : "unchecked", resources: "unchecked", render: "unchecked", postconditions: "unchecked" };
}

/** Local API for hosts and tool adapters. Never imports an AI, CLI or MCP implementation. */
export function createSceneOperationService({ session, adapters = {}, registry = defaultSceneOperationRegistry } = {}) {
  if (!session?.document || typeof session.dispatch !== "function") throw new TypeError("A SceneSession is required.");
  const state = stateFor(session);
  const readDelta = (since) => {
    if (!Number.isSafeInteger(since) || since < state.initialRevision || since > session.revision) throw documentError("DELTA_REVISION_UNAVAILABLE", `Deltas are available from revision ${state.initialRevision} through ${session.revision} in this session.`);
    return { changedIds: [...state.changed].filter(([, revision]) => revision > since).map(([id]) => id), removedIds: [...state.removed].filter(([, revision]) => revision > since).map(([id]) => id) };
  };
  const failure = (error, before = session.revision, requestId) => ({ protocolVersion: SCENE_OPERATION_PROTOCOL_VERSION,
    sessionId: state.id, ...(requestId ? { requestId } : {}), ok: false,
    status: error?.name === "AbortError" ? "cancelled" : /(?:REQUIRED|UNAVAILABLE|DISPOSED)$/.test(error?.code || "") ? "unavailable" : "failed",
    sceneMutated: false, beforeRevision: before, afterRevision: session.revision, revision: session.revision,
    changedIds: [], results: [], error: error?.message || String(error), code: error?.code || "OPERATION_FAILED",
    diagnostics: [{ code: error?.code || "OPERATION_FAILED", message: error?.message || String(error), ...(error?.path ? { path: error.path } : {}) }],
    checks: { arguments: "unchecked", references: "unchecked", structure: "unchecked", geometry: "unchecked", resources: "unchecked", render: "unchecked", postconditions: "unchecked" } });
  const assertOpen = (options) => {
    if (session.disposed) throw documentError("SESSION_DISPOSED", "This scene session has expired; open a new session before sending commands.");
    if (options.sessionId && options.sessionId !== state.id) throw documentError("SESSION_ID_MISMATCH", "The request belongs to another scene session.");
    options.signal?.throwIfAborted();
  };
  const execute = (input, options = {}) => {
    let commands, fingerprint;
    try {
      assertOpen(options);
      commands = cloneDocumentData(typeof input === "string" ? parseCommandScript(input) : Array.isArray(input) ? input.map(parseCommandLine) : [parseCommandLine(input)]);
      if (!commands.length) throw documentError("EMPTY_COMMAND_BATCH", "At least one operation is required.");
      fingerprint = canonical({ commands, baseRevision: options.baseRevision, preflight: Boolean(options.preflight || options.dryRun), historyGroup: options.historyGroup, label: options.label, recordHistory: options.recordHistory });
      if (options.requestId != null && (typeof options.requestId !== "string" || !options.requestId.trim())) throw documentError("INVALID_REQUEST_ID", "requestId must be a non-empty string.");
      const previous = options.requestId && state.requests.get(options.requestId);
      if (previous) return previous.fingerprint === fingerprint ? previous.promise : Promise.resolve(failure(documentError("REQUEST_ID_CONFLICT", "The same requestId was used with different input; do not blindly replay an uncertain write."), session.revision, options.requestId));
    } catch (error) { return Promise.resolve(failure(error, session.revision, options.requestId)); }
    const task = state.queue.then(async () => {
      const before = session.document;
      try {
        assertOpen(options);
        const result = await commitSceneSessionCommands(session, commands, { ...adapters, ...options, operationRegistry: registry, readDelta });
        const checks = coverage(Boolean(result.runtimePrepared || result.sceneMutated && session.runtime));
        const failed = result.results?.find((item) => !item.ok);
        const code = failed?.code || failed?.data?.code || result.error?.code;
        const error = typeof result.error === "string" ? result.error : result.error?.message || failed?.error;
        const status = result.status || (result.ok ? (result.sceneMutated ? "committed" : commands.every((command) => registry.getSpec(command.op)?.category === "read") ? "read" : commands.some((command) => registry.getSpec(command.op)?.category === "draft") ? "draft" : commands.some((command) => registry.getSpec(command.op)?.category === "runtime") ? "applied" : "noop") : options.signal?.aborted ? "cancelled" : /(?:REQUIRED|UNAVAILABLE|DISPOSED)$/.test(code || "") ? "unavailable" : "failed");
        if (!result.ok) { checks.structure = "unchecked"; checks.geometry = "unchecked"; checks.references = "unchecked"; checks.arguments = code === "INVALID_COMMAND_ARGUMENTS" ? "failed" : "passed"; }
        for (const item of result.results || []) if (item.ok) {
          if (item.op === "scene.capture" && item.data?.views?.length && item.data.kind === "scene") checks.render = "passed";
          if (item.op === "scene.check") checks.postconditions = item.data?.checks?.some((check) => check.status === "failed") ? "failed" : item.data?.satisfied ? "passed" : "unchecked";
        }
        return freezeDocumentData(cloneDocumentData({ ...result, error: error || null, ...(code ? { code } : {}), protocolVersion: SCENE_OPERATION_PROTOCOL_VERSION,
          sessionId: state.id, ...(options.requestId ? { requestId: options.requestId } : {}), status,
          beforeRevision: before.revision, afterRevision: session.revision, revision: session.revision,
          changedIds: changes(before, session.document),
          diagnostics: result.ok ? (result.warnings || []).map((message) => ({ code: "VIEWPORT_OPERATION_FAILED", message })) : [{ code: code || "OPERATION_FAILED", message: error || "Operation failed." }],
          checks,
          // Never expose private draft maps, candidate documents or Error instances in transport receipts.
          bufferDrafts: undefined, operations: undefined, document: undefined, viewCommands: undefined
        }));
      } catch (error) { return freezeDocumentData(failure(error, before.revision, options.requestId)); }
    });
    state.queue = task.catch(() => {});
    if (options.requestId) state.requests.set(options.requestId, { fingerprint, promise: task });
    return task;
  };
  return {
    get sessionId() { return state.id; }, get revision() { return session.revision; },
    discover() { return { protocolVersion: SCENE_OPERATION_PROTOCOL_VERSION, sessionId: state.id, revision: session.revision,
      idempotency: "session-lifetime", deltaFromRevision: state.initialRevision, commands: registry.listSpecs(), capabilities: { runtime: Boolean(session.runtime), capture: typeof adapters.capture === "function" || Boolean(session.runtime?.renderer?.domElement?.toDataURL) } }; },
    execute,
    preflight(input, options = {}) { return execute(input, { ...options, preflight: true }); },
    async undo(options = {}) { return history("undo", options); },
    async redo(options = {}) { return history("redo", options); }
  };
  function history(method, options) {
    const fingerprint = canonical({ history: method, baseRevision: options.baseRevision });
    try {
      assertOpen(options);
      if (options.requestId != null && (typeof options.requestId !== "string" || !options.requestId.trim())) throw documentError("INVALID_REQUEST_ID", "requestId must be a non-empty string.");
      const previous = options.requestId && state.requests.get(options.requestId);
      if (previous) return previous.fingerprint === fingerprint ? previous.promise : Promise.resolve(failure(documentError("REQUEST_ID_CONFLICT", "The requestId already belongs to another operation."), session.revision, options.requestId));
    } catch (error) { return Promise.resolve(failure(error, session.revision, options.requestId)); }
    const task = state.queue.then(async () => {
      const before = session.document;
      try {
        assertOpen(options);
        if (options.baseRevision != null && options.baseRevision !== session.revision) throw documentError("STALE_SCENE_REVISION", "Scene changed before history operation.");
        const event = await session[method](options);
        return freezeDocumentData({ protocolVersion: SCENE_OPERATION_PROTOCOL_VERSION, ...(options.requestId ? { requestId: options.requestId } : {}), ok: true, status: event.changed ? "committed" : "noop", sessionId: state.id,
          beforeRevision: before.revision, afterRevision: session.revision, revision: session.revision, changedIds: changes(before, session.document), sceneMutated: Boolean(event.changed), results: [], checks: coverage() });
      } catch (error) { return freezeDocumentData(failure(error, before.revision, options.requestId)); }
    });
    if (options.requestId) state.requests.set(options.requestId, { fingerprint, promise: task });
    state.queue = task.catch(() => {}); return task;
  }
}

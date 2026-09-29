import { createSceneSession, createRuntimeSceneSession, createSceneOperationService, captureSceneSession } from "threejson/session";
import { readVersionedFile, writeVersionedFile, toolError } from "./files.js";
import { randomUUID } from "node:crypto";
import path from "node:path";

/** Application sessions survive individual tool calls, never a server process restart. */
export function createSceneToolHost({ workspace = process.cwd(), runtimeOptions = {}, registry, mediaRenderer } = {}) {
  const sessions = new Map(), jobs = new Map();
  const requireSession = (id) => {
    const entry = sessions.get(id);
    if (!entry) throw toolError("SESSION_EXPIRED", "Unknown or expired session. Open the scene again; do not replay an uncertain write blindly.");
    return entry;
  };
  const host = {
    async open({ file, json, runtime = false } = {}) {
      const resolved = file ? path.resolve(workspace, file) : null;
      const source = resolved ? await readVersionedFile(resolved) : null;
      if (resolved && !source.bytes) throw toolError("FILE_NOT_FOUND", `Scene file not found: ${resolved}`);
      if (source) json = JSON.parse(source.bytes.toString("utf8"));
      const session = runtime ? await createRuntimeSceneSession(json || { objectList: [] }, runtimeOptions) : createSceneSession(json || { objectList: [] });
      const service = createSceneOperationService({ session, registry });
      sessions.set(service.sessionId, { session, service, file: resolved, fileVersion: source?.version || null });
      return { ok: true, sessionId: service.sessionId, revision: session.revision, file: resolved, fileVersion: source?.version || null, mode: runtime ? "runtime" : "document", checks: { render: "unchecked" } };
    },
    list() { return { ok: true, sessions: [...sessions].map(([sessionId, entry]) => ({ sessionId, revision: entry.session.revision, file: entry.file, mode: entry.session.runtime ? "runtime" : "document" })) }; },
    close({ sessionId }) {
      const entry = requireSession(sessionId);
      for (const job of jobs.values()) if (job.sessionId === sessionId && job.status === "running") job.controller.abort();
      entry.session.dispose(); sessions.delete(sessionId); return { ok: true, status: "closed", sessionId };
    },
    discover({ sessionId } = {}) {
      if (sessionId) return { ok: true, ...requireSession(sessionId).service.discover() };
      const session = createSceneSession({ objectList: [] });
      try { return { ok: true, ...createSceneOperationService({ session, registry }).discover(), sessionId: null }; } finally { session.dispose(); }
    },
    async apply({ sessionId, commands, ...options }) { return requireSession(sessionId).service.execute(commands, { ...options, sessionId }); },
    async preflight({ sessionId, commands, ...options }) { return requireSession(sessionId).service.preflight(commands, { ...options, sessionId }); },
    async undo({ sessionId, ...options }) { return requireSession(sessionId).service.undo(options); },
    async redo({ sessionId, ...options }) { return requireSession(sessionId).service.redo(options); },
    async export({ sessionId, file, format = "standard", expectedFileVersion } = {}) {
      const entry = requireSession(sessionId), revision = entry.session.revision, json = captureSceneSession(entry.session, { format });
      if (!file) return { ok: true, sessionId, revision, json };
      const resolved = path.resolve(workspace, file);
      const expected = expectedFileVersion === undefined && resolved === entry.file ? entry.fileVersion : expectedFileVersion;
      const result = await writeVersionedFile(resolved, `${JSON.stringify(json, null, 2)}\n`, expected === undefined ? null : expected);
      if (resolved === entry.file) entry.fileVersion = result.version;
      return { ok: true, sessionId, revision, ...result };
    },
    async query({ sessionId, ...args }) { return host.apply({ sessionId, commands: [{ op: "scene.query", args }] }); },
    async observe({ sessionId, ...args }) { return host.apply({ sessionId, commands: [{ op: "scene.observe", args }] }); },
    async check({ sessionId, ...args }) { return host.apply({ sessionId, commands: [{ op: "scene.check", args }] }); },
    async capture({ sessionId, ...args }) { return host.apply({ sessionId, commands: [{ op: "scene.capture", args }] }); },
    startJob({ sessionId, commands, ...options }) {
      requireSession(sessionId);
      const jobId = randomUUID(), controller = new AbortController();
      const job = { sessionId, status: "running", stage: "preparing", controller, startedAt: new Date().toISOString() }; jobs.set(jobId, job);
      job.promise = host.apply({ ...options, sessionId, commands, signal: controller.signal }).then((result) => {
        job.result = result; job.status = result.status === "cancelled" ? "cancelled" : result.ok ? "completed" : "failed"; job.stage = job.status;
      }, (error) => { job.status = "failed"; job.result = { ok: false, error: error.message, code: error.code }; });
      return { ok: true, jobId, sessionId, status: "running" };
    },
    startMediaJob(options) {
      if (!options?.output || !options.file && !options.sessionId) throw toolError("MEDIA_INPUT_REQUIRED", "Provide an output and a scene file or sessionId.");
      const json = options.sessionId ? captureSceneSession(requireSession(options.sessionId).session) : undefined;
      const jobId = randomUUID(), controller = new AbortController();
      const job = { sessionId: options.sessionId, status: "running", stage: "preparing", controller, startedAt: new Date().toISOString() }; jobs.set(jobId, job);
      job.promise = (async () => {
        const render = mediaRenderer || (await import("./media.js")).renderSceneMedia;
        controller.signal.throwIfAborted();
        return render({ ...options, json, file: json ? undefined : path.resolve(workspace, options.file), output: path.resolve(workspace, options.output), signal: controller.signal,
          onProgress(value) { job.stage = value.stage; job.progress = value; }
        });
      })().then((result) => {
        job.result = result; job.status = result.status === "cancelled" ? "cancelled" : result.ok ? "completed" : "failed"; job.stage = job.status;
      }, (error) => { job.status = controller.signal.aborted ? "cancelled" : "failed"; job.stage = job.status; job.result = { ok: false, error: error.message, code: error.code }; });
      return { ok: true, jobId, sessionId: options.sessionId, status: "running" };
    },
    job({ jobId }) { const job = jobs.get(jobId); if (!job) throw toolError("JOB_NOT_FOUND", "Unknown job."); return { ok: true, jobId, sessionId: job.sessionId, status: job.status, stage: job.stage, progress: job.progress, startedAt: job.startedAt, result: job.result }; },
    cancel({ jobId }) { const job = jobs.get(jobId); if (!job) throw toolError("JOB_NOT_FOUND", "Unknown job."); if (job.status === "running") job.controller.abort(); return { ok: true, jobId, status: job.status, cancellationRequested: job.status === "running" }; },
    async dispose() { for (const [sessionId] of sessions) host.close({ sessionId }); for (const job of jobs.values()) if (job.status === "running") job.controller.abort(); await Promise.all([...jobs.values()].map((job) => job.promise)); jobs.clear(); }
  };
  return host;
}

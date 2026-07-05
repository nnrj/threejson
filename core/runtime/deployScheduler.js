import { log } from "../util/logger.js";
/**
 * Scene object deploy job scheduler: immediate runs straight through; scheduled supports per-frame (frameBudget), timeslot, and async concurrency pool.
 */

const DEPLOY_PHASES = [2, 3, 4];

/** @type {{ cancelled: boolean, timers: number[], rafId: number|null, onCancel: (() => void)|null }|null} */
let activeRun = null;

/**
 * @param {object} [sceneConfig]
 * @param {object|null} [recordSchedulerOverride] Per-record deployScheduler (shallow-merged with scene config)
 * @returns {{
 *   mode: "immediate"|"scheduled",
 *   policy: "frameBudget"|"timeslot",
 *   maxJobsPerFrame: number,
 *   maxFrameMs: number,
 *   fluxMs: number,
 *   density: number,
 *   maxInFlightAsync: number,
 *   retry: { maxAttempts: number, backoffMs: number }
 * }}
 */
export function resolveDeploySchedulerConfig(sceneConfig = {}, recordSchedulerOverride = null) {
  const sceneRoot =
    sceneConfig?.deployScheduler && typeof sceneConfig.deployScheduler === "object"
      ? sceneConfig.deployScheduler
      : {};
  const recordRoot =
    recordSchedulerOverride && typeof recordSchedulerOverride === "object"
      ? recordSchedulerOverride
      : {};
  const root =
    recordSchedulerOverride && typeof recordSchedulerOverride === "object"
      ? { ...sceneRoot, ...recordRoot }
      : sceneConfig?.deployScheduler;
  const defaults = {
    mode: "immediate",
    policy: "frameBudget",
    maxJobsPerFrame: 12,
    maxFrameMs: 8,
    fluxMs: 10,
    density: 10,
    maxInFlightAsync: 4,
    retry: { maxAttempts: 0, backoffMs: 400 }
  };
  if (!root || typeof root !== "object") {
    return defaults;
  }
  if (root.enabled === false || root.mode === "immediate") {
    return { ...defaults, mode: "immediate" };
  }
  const scheduled = root.mode === "scheduled" || root.enabled === true;
  if (!scheduled) {
    return { ...defaults, mode: "immediate" };
  }
  const policy = root.policy === "timeslot" ? "timeslot" : "frameBudget";
  const retryRoot = root.retry && typeof root.retry === "object" ? root.retry : {};
  return {
    mode: "scheduled",
    policy,
    maxJobsPerFrame: Number.isFinite(Number(root.maxJobsPerFrame))
      ? Math.max(1, Math.floor(Number(root.maxJobsPerFrame)))
      : defaults.maxJobsPerFrame,
    maxFrameMs: Number.isFinite(Number(root.maxFrameMs))
      ? Math.max(1, Number(root.maxFrameMs))
      : defaults.maxFrameMs,
    fluxMs: Number.isFinite(Number(root.fluxMs)) ? Math.max(0, Number(root.fluxMs)) : defaults.fluxMs,
    density: Number.isFinite(Number(root.density))
      ? Math.max(1, Math.floor(Number(root.density)))
      : defaults.density,
    maxInFlightAsync: Number.isFinite(Number(root.maxInFlightAsync))
      ? Math.max(1, Math.floor(Number(root.maxInFlightAsync)))
      : defaults.maxInFlightAsync,
    retry: {
      maxAttempts: Number.isFinite(Number(retryRoot.maxAttempts))
        ? Math.max(0, Math.floor(Number(retryRoot.maxAttempts)))
        : defaults.retry.maxAttempts,
      backoffMs: Number.isFinite(Number(retryRoot.backoffMs))
        ? Math.max(0, Number(retryRoot.backoffMs))
        : defaults.retry.backoffMs
    }
  };
}

/**
 * Whether a single record jumps the scheduled queue with immediate deploy.
 * @param {object} sceneConfig
 * @param {object} record
 */
export function isRecordDeployImmediate(sceneConfig, record) {
  if (!record?.deployScheduler || typeof record.deployScheduler !== "object") {
    return false;
  }
  return resolveDeploySchedulerConfig(sceneConfig, record.deployScheduler).mode === "immediate";
}

/**
 * @param {Array<object>} records
 * @param {(record: object) => void|Promise<void>} deployOne
 * @param {(record: object) => number} [getPhase]
 * @param {object} [sceneConfig]
 * @returns {Array<{
 *   id: string,
 *   phase: number,
 *   priority: number,
 *   kind: "sync"|"async",
 *   forceImmediate: boolean,
 *   run: () => void|Promise<void>
 * }>}
 */
export function buildDeployJobs(records, deployOne, getPhase, sceneConfig = {}) {
  const jobs = [];
  if (!Array.isArray(records) || typeof deployOne !== "function") {
    return jobs;
  }
  const resolvePhase = typeof getPhase === "function" ? getPhase : getRecordDeployPhase;
  const sceneScheduled =
    resolveDeploySchedulerConfig(sceneConfig).mode === "scheduled";
  for (let pi = 0; pi < DEPLOY_PHASES.length; pi++) {
    const phase = DEPLOY_PHASES[pi];
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!record || typeof record !== "object") {
        continue;
      }
      const recordPhase = resolvePhase(record);
      if (recordPhase !== phase) {
        continue;
      }
      const priority = Number.isFinite(Number(record.priority)) ? Number(record.priority) : 0;
      const id = typeof record.id === "string" && record.id ? record.id : `deploy-${phase}-${i}`;
      const forceImmediate = sceneScheduled && isRecordDeployImmediate(sceneConfig, record);
      const kind = recordPhase === 3 ? "async" : "sync";
      jobs.push({
        id,
        phase,
        priority,
        kind,
        forceImmediate,
        run: () => deployOne(record)
      });
    }
  }
  return jobs;
}

/**
 * @param {object} record
 * @returns {number}
 */
function getRecordDeployPhase(record) {
  const objType = typeof record.objType === "string" ? record.objType.trim().toLowerCase() : "";
  if (!objType) {
    return 0;
  }
  if (objType === "externalmodel") {
    return 3;
  }
  if (objType === "domain") {
    return 4;
  }
  return 2;
}

function delayMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {{ run: () => void|Promise<void> }} job
 * @param {ReturnType<typeof resolveDeploySchedulerConfig>} config
 * @param {{ cancelled: boolean }} run
 */
async function executeJobWithRetry(job, config, run) {
  const maxAttempts = job.kind === "async" ? config.retry.maxAttempts : 0;
  const backoffMs = config.retry.backoffMs;
  let attempt = 0;
  while (true) {
    if (run.cancelled) {
      return;
    }
    try {
      const result = job.run();
      if (result && typeof result.then === "function") {
        await result;
      }
      return;
    } catch (err) {
      attempt += 1;
      if (attempt > maxAttempts) {
        log.warn("[deployScheduler] job failed:", job.id, err);
        return;
      }
      await delayMs(backoffMs * attempt);
    }
  }
}

/**
 * @param {Array<object>} jobs
 * @param {ReturnType<typeof resolveDeploySchedulerConfig>} config
 * @param {{ cancelled: boolean }} run
 * @param {(job: object) => void} notify
 */
async function runAsyncJobPool(jobs, config, run, notify) {
  if (!jobs.length) {
    return;
  }
  const maxInFlight = Math.max(1, config.maxInFlightAsync);
  let index = 0;
  const worker = async () => {
    while (!run.cancelled) {
      const jobIndex = index;
      index += 1;
      if (jobIndex >= jobs.length) {
        return;
      }
      const job = jobs[jobIndex];
      await executeJobWithRetry(job, config, run);
      if (!run.cancelled) {
        notify(job);
      }
    }
  };
  const poolSize = Math.min(maxInFlight, jobs.length);
  const workers = [];
  for (let w = 0; w < poolSize; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

const RUN_DEPLOY_JOBS_CONFIG = Object.freeze({
  retry: { maxAttempts: 0, backoffMs: 400 }
});

/**
 * Burst deploy without awaiting async jobs (fire-and-forget). For sync scene load subset paths
 * (e.g. createJsonSceneSimple). When async jobs must complete before return, use {@link runDeployJobs}.
 * @param {Array<object>} jobs
 */
export function runDeployJobsImmediate(jobs) {
  const sorted = sortDeployJobs(jobs);
  for (let i = 0; i < sorted.length; i++) {
    try {
      const result = sorted[i].run();
      if (result && typeof result.then === "function") {
        void result.catch((err) => {
          log.warn("[deployScheduler] async job failed:", sorted[i].id, err);
        });
      }
    } catch (err) {
      log.warn("[deployScheduler] job failed:", err);
    }
  }
}

/**
 * Run all deploy jobs in sorted order without frame spreading; awaits async jobs (externalmodel, etc.).
 * Used when deployScheduler.mode is "immediate" on async scene load paths (e.g. createJsonScene).
 * For fire-and-forget burst deploy (sync subset), use {@link runDeployJobsImmediate}.
 * @param {Array<object>} jobs
 * @param {{ onProgress?: (info: { done: number, total: number, phase: number, id?: string }) => void }} [hooks]
 * @returns {Promise<void>}
 */
export async function runDeployJobs(jobs, hooks = {}) {
  const sorted = sortDeployJobs(jobs);
  const run = { cancelled: false };
  const total = sorted.length;
  const onProgress = typeof hooks.onProgress === "function" ? hooks.onProgress : null;
  for (let i = 0; i < sorted.length; i++) {
    await executeJobWithRetry(sorted[i], RUN_DEPLOY_JOBS_CONFIG, run);
    if (onProgress) {
      onProgress({
        done: i + 1,
        total,
        phase: sorted[i]?.phase ?? 0,
        id: sorted[i]?.id
      });
    }
  }
}

/**
 * @param {Array<object>} jobs
 * @param {ReturnType<typeof resolveDeploySchedulerConfig>} config
 * @param {{ onProgress?: (info: { done: number, total: number, phase: number, id?: string }) => void }} [hooks]
 * @returns {Promise<void>}
 */
export function runDeployJobsScheduled(jobs, config, hooks = {}) {
  cancelActiveDeployScheduler();
  const sorted = sortDeployJobs(jobs);
  if (sorted.length === 0) {
    return Promise.resolve();
  }
  const run = {
    cancelled: false,
    timers: [],
    rafId: null,
    onCancel: null
  };
  activeRun = run;
  const phaseGroups = groupJobsByDeployPhase(sorted);
  const total = sorted.length;
  let done = 0;
  const onProgress = typeof hooks.onProgress === "function" ? hooks.onProgress : null;

  const notify = (job) => {
    done += 1;
    if (onProgress) {
      onProgress({
        done,
        total,
        phase: job?.phase ?? 0,
        id: job?.id
      });
    }
  };

  const runSyncScheduled = (syncJobs) => {
    if (!syncJobs.length) {
      return Promise.resolve();
    }
    const wrapped = syncJobs.map((job) => ({
      ...job,
      run: async () => {
        await executeJobWithRetry(job, config, run);
        notify(job);
      }
    }));
    if (config.policy === "timeslot") {
      return runTimeslot(wrapped, config, run);
    }
    return runFrameBudget(wrapped, config, run);
  };

  const runPhase = async (phaseJobs) => {
    if (run.cancelled || phaseJobs.length === 0) {
      return;
    }
    const immediateJobs = [];
    const scheduledJobs = [];
    for (let i = 0; i < phaseJobs.length; i++) {
      const job = phaseJobs[i];
      if (job.forceImmediate) {
        immediateJobs.push(job);
      } else {
        scheduledJobs.push(job);
      }
    }
    const sortedImmediate = sortDeployJobs(immediateJobs);
    for (let i = 0; i < sortedImmediate.length; i++) {
      if (run.cancelled) {
        return;
      }
      const job = sortedImmediate[i];
      await executeJobWithRetry(job, config, run);
      notify(job);
    }
    const asyncJobs = scheduledJobs.filter((job) => job.kind === "async");
    const syncJobs = scheduledJobs.filter((job) => job.kind !== "async");
    await runSyncScheduled(syncJobs);
    if (run.cancelled) {
      return;
    }
    await runAsyncJobPool(asyncJobs, config, run, notify);
  };

  return phaseGroups
    .reduce(
      (chain, phaseJobs) =>
        chain.then(() => {
          if (run.cancelled) {
            return;
          }
          return runPhase(phaseJobs);
        }),
      Promise.resolve()
    )
    .then(() => {
      if (activeRun === run) {
        activeRun = null;
      }
    });
}

/**
 * @param {Array<{ phase: number }>} jobs
 * @returns {Array<Array<object>>}
 */
function groupJobsByDeployPhase(jobs) {
  const buckets = new Map();
  for (let i = 0; i < DEPLOY_PHASES.length; i++) {
    buckets.set(DEPLOY_PHASES[i], []);
  }
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const list = buckets.get(job.phase);
    if (list) {
      list.push(job);
    }
  }
  const groups = [];
  for (let pi = 0; pi < DEPLOY_PHASES.length; pi++) {
    const list = buckets.get(DEPLOY_PHASES[pi]);
    if (list && list.length > 0) {
      groups.push(list);
    }
  }
  return groups;
}

/**
 * Cancel an in-flight scheduled deploy (call when switching scenes).
 */
export function cancelActiveDeployScheduler() {
  if (!activeRun) {
    return;
  }
  activeRun.cancelled = true;
  for (let i = 0; i < activeRun.timers.length; i++) {
    clearTimeout(activeRun.timers[i]);
  }
  if (activeRun.rafId != null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(activeRun.rafId);
  }
  if (typeof activeRun.onCancel === "function") {
    try {
      activeRun.onCancel();
    } catch (_err) {
      /* ignore */
    }
  }
  activeRun = null;
}

/**
 * @param {Array<{ phase: number, priority: number }>} jobs
 */
function sortDeployJobs(jobs) {
  return [...jobs].sort((a, b) => {
    if (a.phase !== b.phase) {
      return a.phase - b.phase;
    }
    return b.priority - a.priority;
  });
}

/**
 * @param {Array<{ run: () => void|Promise<void> }>} jobs
 * @param {object} config
 * @param {{ cancelled: boolean, timers: number[], rafId: number|null, onCancel: (() => void)|null }} run
 * @returns {Promise<void>}
 */
function runFrameBudget(jobs, config, run) {
  return new Promise((resolve) => {
    let index = 0;
    const pump = async () => {
      if (run.cancelled) {
        resolve();
        return;
      }
      const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      let count = 0;
      while (
        index < jobs.length
        && count < config.maxJobsPerFrame
        && (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0 < config.maxFrameMs
      ) {
        try {
          const result = jobs[index].run();
          if (result && typeof result.then === "function") {
            await result;
          }
        } catch (err) {
          log.warn("[deployScheduler] job failed:", err);
        }
        index += 1;
        count += 1;
      }
      if (index >= jobs.length || run.cancelled) {
        resolve();
        return;
      }
      if (typeof requestAnimationFrame === "function") {
        run.rafId = requestAnimationFrame(() => {
          void pump();
        });
      } else {
        run.timers.push(setTimeout(() => void pump(), 16));
      }
    };
    void pump();
  });
}

/**
 * @param {Array<{ run: () => void|Promise<void> }>} jobs
 * @param {object} config
 * @param {{ cancelled: boolean, timers: number[], rafId: number|null, onCancel: (() => void)|null }} run
 * @returns {Promise<void>}
 */
function runTimeslot(jobs, config, run) {
  return new Promise((resolve) => {
    let pending = jobs.length;
    let delayCount = 0;
    const finish = () => {
      resolve();
    };
    run.onCancel = () => {
      pending = 0;
      finish();
    };
    const done = () => {
      pending -= 1;
      if (pending <= 0) {
        finish();
      }
    };
    for (let i = 0; i < jobs.length; i++) {
      const slot = delayCount * config.fluxMs;
      const job = jobs[i];
      const timerId = setTimeout(() => {
        if (run.cancelled) {
          done();
          return;
        }
        void (async () => {
          try {
            const result = job.run();
            if (result && typeof result.then === "function") {
              await result;
            }
          } catch (err) {
            log.warn("[deployScheduler] job failed:", err);
          }
          done();
        })();
      }, slot);
      run.timers.push(timerId);
      if (i % config.density === 0) {
        delayCount += 1;
      }
    }
  });
}

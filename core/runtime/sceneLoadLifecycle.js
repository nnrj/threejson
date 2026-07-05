import { log } from "../util/logger.js";
/**
 * Scene load / teardown / frame lifecycle bus.
 * Zero subscribers = near-zero cost (short-circuit on emit).
 */

/** @type {Array<{ name: string, phase: string, priority: number, handler: Function }>} */
const registeredExtensions = [];

const LOAD_PHASE = Object.freeze({
  beforeNormalize: "load:beforeNormalize",
  afterNormalize: "load:afterNormalize",
  beforeRuntime: "load:beforeRuntime",
  onRuntimeReady: "load:onRuntimeReady",
  beforeDeploy: "load:beforeDeploy",
  onDeployProgress: "load:onDeployProgress",
  afterDeploy: "load:afterDeploy",
  afterCameraFit: "load:afterCameraFit",
  onSceneReady: "load:onSceneReady",
  onAssetsReady: "load:onAssetsReady",
  onError: "load:onError"
});

const TEARDOWN_PHASE = Object.freeze({
  beforeCancel: "teardown:beforeCancel",
  onDeployCancelled: "teardown:onDeployCancelled",
  beforeDispose: "teardown:beforeDispose",
  onDisposed: "teardown:onDisposed"
});

const FRAME_PHASE = Object.freeze({
  beforeFrame: "frame:beforeFrame",
  beforeRender: "frame:beforeRender",
  afterRender: "frame:afterRender"
});

/**
 * @param {string} phase
 * @param {object} [partial]
 * @returns {object}
 */
function createSceneLifecycleContext(phase, partial = {}) {
  return {
    phase,
    options: partial.options ?? {},
    ...partial
  };
}

/**
 * @param {string} phase
 * @param {object} [partial]
 * @returns {object}
 */
function createFrameContext(phase, partial = {}) {
  return {
    phase,
    now: partial.now ?? 0,
    deltaSeconds: partial.deltaSeconds,
    scene: partial.scene ?? null,
    camera: partial.camera ?? null,
    renderer: partial.renderer ?? null,
    renderLoop: partial.renderLoop ?? null,
    clock: partial.clock ?? null
  };
}

/**
 * @param {object} ext
 * @param {string} ext.name
 * @param {string} ext.phase
 * @param {number} [ext.priority]
 * @param {Function} ext.handler
 */
function registerSceneLoadLifecycleExtension(ext) {
  if (!ext || typeof ext.handler !== "function" || !ext.phase) {
    throw new Error("registerSceneLoadLifecycleExtension: phase and handler required");
  }
  registeredExtensions.push({
    name: ext.name || ext.phase,
    phase: ext.phase,
    priority: Number.isFinite(ext.priority) ? ext.priority : 0,
    handler: ext.handler
  });
}

/**
 * @param {object} [options]
 * @returns {import('./sceneLoadLifecycle.js').SceneLifecycleBus}
 */
function createSceneLifecycleBus(loadOptions = {}) {
  /** @type {Map<string, Array<{ name: string, priority: number, handler: Function }>>} */
  const subscribers = new Map();

  function on(phase, entry) {
    if (!phase || typeof entry?.handler !== "function") {
      return;
    }
    const list = subscribers.get(phase) || [];
    list.push({
      name: entry.name || phase,
      priority: Number.isFinite(entry.priority) ? entry.priority : 100,
      handler: entry.handler
    });
    subscribers.set(phase, list);
  }

  function has(phase) {
    const list = subscribers.get(phase);
    return Array.isArray(list) && list.length > 0;
  }

  async function emit(phase, ctx) {
    const list = subscribers.get(phase);
    if (!list?.length) {
      return;
    }
    const sorted = list.slice().sort((a, b) => a.priority - b.priority);
    const payload =
      ctx && typeof ctx === "object" ? Object.assign(ctx, { phase }) : createSceneLifecycleContext(phase);
    for (let i = 0; i < sorted.length; i++) {
      await sorted[i].handler(payload);
    }
  }

  /**
   * Sync load emit for createJsonSceneSimple; warns when a handler returns a Promise.
   * @param {string} phase
   * @param {object} ctx
   * @param {string} [syncLabel]
   */
  function emitLoadSync(phase, ctx, syncLabel = "createJsonSceneSimple") {
    const list = subscribers.get(phase);
    if (!list?.length) {
      return;
    }
    const sorted = list.slice().sort((a, b) => a.priority - b.priority);
    const payload =
      ctx && typeof ctx === "object" ? Object.assign(ctx, { phase }) : createSceneLifecycleContext(phase);
    for (let i = 0; i < sorted.length; i++) {
      const result = sorted[i].handler(payload);
      if (result && typeof result.then === "function") {
        log.warn(
          `[${syncLabel}] ${phase} returned Promise; use createJsonScene to await async hooks`
        );
      }
    }
  }

  function emitSync(phase, ctx) {
    const list = subscribers.get(phase);
    if (!list?.length) {
      return;
    }
    const sorted = list.slice().sort((a, b) => a.priority - b.priority);
    const payload = ctx && typeof ctx === "object" ? { ...ctx, phase } : createFrameContext(phase);
    for (let i = 0; i < sorted.length; i++) {
      sorted[i].handler(payload);
    }
  }

  /**
   * @param {object} baseCtx partial lifecycle ctx reused across progress events
   * @param {{ minIntervalMs?: number }} [throttleOpts]
   */
  function createDeployProgressEmitter(baseCtx, throttleOpts = {}) {
    const minIntervalMs = Number.isFinite(throttleOpts.minIntervalMs)
      ? Math.max(0, throttleOpts.minIntervalMs)
      : 16;
    let lastEmitMs = null;
    let pending = null;
    let rafId = null;

    const dispatch = (deploy) => {
      emitLoadSync(LOAD_PHASE.onDeployProgress, Object.assign(baseCtx, { deploy }));
    };

    const flush = () => {
      rafId = null;
      if (!pending) {
        return;
      }
      const deploy = pending;
      pending = null;
      lastEmitMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      dispatch(deploy);
    };

    return (info) => {
      const deploy = {
        done: info.done,
        total: info.total,
        id: info.id,
        jobPhase: info.phase ?? info.jobPhase ?? 0
      };
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (lastEmitMs === null || minIntervalMs <= 0 || nowMs - lastEmitMs >= minIntervalMs) {
        lastEmitMs = nowMs;
        pending = null;
        if (rafId !== null && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        dispatch(deploy);
        return;
      }
      pending = deploy;
      if (rafId === null && typeof requestAnimationFrame === "function") {
        rafId = requestAnimationFrame(flush);
      }
    };
  }

  return {
    on,
    has,
    emit,
    emitSync,
    emitLoadSync,
    createDeployProgressEmitter,
    loadOptions
  };
}

const FLAT_LOAD_HOOKS = Object.freeze({
  onRuntimeReady: LOAD_PHASE.onRuntimeReady,
  onSceneReady: LOAD_PHASE.onSceneReady,
  onDeployProgress: LOAD_PHASE.onDeployProgress,
  onAssetsReady: LOAD_PHASE.onAssetsReady
});

const FLAT_FRAME_HOOKS = Object.freeze({
  beforeFrame: FRAME_PHASE.beforeFrame,
  beforeRender: FRAME_PHASE.beforeRender,
  afterRender: FRAME_PHASE.afterRender
});

/**
 * Merge flat options, nested lifecycle, and registered extensions onto a bus.
 * @param {object} [options]
 * @param {object} [options.lifecycle]
 * @returns {{ bus: ReturnType<typeof createSceneLifecycleBus>, frameRuntime: object|null }}
 */
function resolveLifecycleHooks(options = {}) {
  const bus = createSceneLifecycleBus(options);
  const lifecycle =
    options.lifecycle && typeof options.lifecycle === "object" ? options.lifecycle : {};

  for (const [flatKey, phase] of Object.entries(FLAT_LOAD_HOOKS)) {
    if (typeof options[flatKey] === "function") {
      bus.on(phase, { name: flatKey, priority: 100, handler: options[flatKey] });
    }
    if (typeof lifecycle[flatKey] === "function") {
      bus.on(phase, { name: `lifecycle.${flatKey}`, priority: 100, handler: lifecycle[flatKey] });
    }
  }

  for (const [flatKey, phase] of Object.entries(FLAT_FRAME_HOOKS)) {
    if (typeof options[flatKey] === "function") {
      bus.on(phase, {
        name: flatKey,
        priority: 100,
        handler: (frameCtx) => options[flatKey](frameCtx)
      });
    }
    if (typeof lifecycle[flatKey] === "function") {
      bus.on(phase, {
        name: `lifecycle.${flatKey}`,
        priority: 100,
        handler: lifecycle[flatKey]
      });
    }
  }

  for (let i = 0; i < registeredExtensions.length; i++) {
    const ext = registeredExtensions[i];
    bus.on(ext.phase, {
      name: ext.name,
      priority: ext.priority,
      handler: ext.handler
    });
  }

  return { bus };
}

/**
 * Build scene-ready fields shared by onSceneReady ctx.
 * @param {object} deployed
 * @param {object} normalized
 * @param {object} [options]
 */
function buildSceneReadyFields(deployed, normalized, options = {}) {
  return {
    scene: deployed.scene,
    camera: deployed.camera ?? null,
    renderer: deployed.renderer ?? null,
    controls: deployed.controls ?? null,
    controlsConfig: normalized.controlsConfig ?? null,
    renderLoop: deployed.renderLoop ?? null,
    sceneJson: normalized.compatPayload,
    sourceSceneJson: normalized.sourcePayload,
    payload: normalized.payload,
    normalizedPayload: deployed.normalizedPayload ?? normalized.payload,
    worldInfo: normalized.worldInfo,
    sceneConfig: normalized.sceneConfig,
    objectList: normalized.objectList,
    pluginHost: options.pluginHost ?? options.context?.pluginHost ?? null,
    runtime: deployed,
    deployed
  };
}

/**
 * @param {object} runtime
 * @param {object} normalized
 * @param {object} [options]
 */
function buildRuntimeReadyFields(runtime, normalized, options = {}) {
  return {
    runtime,
    normalized,
    scene: runtime?.scene ?? null,
    camera: runtime?.camera ?? null,
    renderer: runtime?.renderer ?? null,
    controls: runtime?.controls ?? null,
    renderLoop: runtime?.renderLoop ?? null,
    sceneJson: normalized?.compatPayload,
    sourceSceneJson: normalized?.sourcePayload,
    payload: normalized?.payload,
    normalizedPayload: normalized?.payload,
    worldInfo: normalized?.worldInfo,
    sceneConfig: normalized?.sceneConfig,
    objectList: normalized?.objectList,
    pluginHost: options.pluginHost ?? options.context?.pluginHost ?? null
  };
}

function _clearLifecycleExtensionsForTests() {
  registeredExtensions.length = 0;
}

export {
  LOAD_PHASE,
  TEARDOWN_PHASE,
  FRAME_PHASE,
  createSceneLifecycleContext,
  createFrameContext,
  createSceneLifecycleBus,
  registerSceneLoadLifecycleExtension,
  resolveLifecycleHooks,
  buildSceneReadyFields,
  buildRuntimeReadyFields,
  _clearLifecycleExtensionsForTests
};

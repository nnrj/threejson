/**
 * Optional plugin host: does not pull heavy dependencies into core; concrete plugins register via `extensions/` or upstream.
 */

import { log } from "../util/logger.js";
import {
  FRAME_PHASE,
  LOAD_PHASE,
  TEARDOWN_PHASE
} from "../runtime/sceneLoadLifecycle.js";

/**
 * @typedef {object} PluginHostContext
 * @property {import("three").Scene|null} [scene]
 * @property {import("three").WebGLRenderer|null} [renderer]
 * @property {import("three").Clock} [clock]
 * @property {number} [deltaSeconds]
 * @property {number} [nowMs]
 * @property {number} [now]
 */

/**
 * @typedef {object} ThreeJsonPlugin
 * @property {string} name
 * @property {(ctx: PluginHostContext) => void|Promise<void>} [init]
 * @property {() => void} [dispose]
 * @property {(ctx: PluginHostContext) => void} [beforeFrame]
 * @property {(ctx: PluginHostContext) => void} [beforeRender]
 * @property {(ctx: PluginHostContext) => void} [afterRender]
 * @property {(ctx: PluginHostContext) => void} [beforePhysics]
 * @property {(ctx: PluginHostContext) => void} [afterPhysics]
 */

function sceneCtxToPluginCtx(sceneCtx) {
  const now = sceneCtx?.now ?? sceneCtx?.nowMs ?? 0;
  return {
    scene: sceneCtx?.scene ?? null,
    renderer: sceneCtx?.renderer ?? null,
    clock: sceneCtx?.clock ?? null,
    deltaSeconds: sceneCtx?.deltaSeconds,
    nowMs: now,
    now
  };
}

function sceneCtxToPluginInitCtx(sceneCtx) {
  return {
    scene: sceneCtx?.scene ?? sceneCtx?.runtime?.scene ?? null,
    renderer: sceneCtx?.renderer ?? sceneCtx?.runtime?.renderer ?? null,
    clock: sceneCtx?.clock ?? null
  };
}

/**
 * @param {{ bus?: object }} [options]
 */
function createPluginHost(options = {}) {
  /** @type {ThreeJsonPlugin[]} */
  const plugins = [];
  /** @type {object|null} */
  let lifecycleBus = options.bus ?? null;
  let busWired = false;

  function invokePluginField(field, ctx) {
    for (let i = 0; i < plugins.length; i++) {
      plugins[i][field]?.(ctx);
    }
  }

  function wireHostToBus(bus) {
    if (!bus || busWired) {
      return;
    }
    busWired = true;
    bus.on(LOAD_PHASE.onSceneReady, {
      name: "pluginHost:init",
      priority: 50,
      handler: async (ctx) => {
        const initCtx = sceneCtxToPluginInitCtx(ctx);
        for (let i = 0; i < plugins.length; i++) {
          if (typeof plugins[i].init === "function") {
            await plugins[i].init(initCtx);
          }
        }
      }
    });
    bus.on(TEARDOWN_PHASE.onDisposed, {
      name: "pluginHost:dispose",
      priority: 50,
      handler: () => {
        for (let i = plugins.length - 1; i >= 0; i--) {
          try {
            plugins[i].dispose?.();
          } catch (_) {
            /* ignore */
          }
        }
      }
    });
    bus.on(FRAME_PHASE.beforeFrame, {
      name: "pluginHost:beforeFrame",
      priority: 50,
      handler: (frameCtx) => {
        const ctx = sceneCtxToPluginCtx(frameCtx);
        invokePluginField("beforeFrame", ctx);
        invokePluginField("beforePhysics", ctx);
      }
    });
    bus.on(FRAME_PHASE.beforeRender, {
      name: "pluginHost:beforeRender",
      priority: 50,
      handler: (frameCtx) => {
        invokePluginField("beforeRender", sceneCtxToPluginCtx(frameCtx));
      }
    });
    bus.on(FRAME_PHASE.afterRender, {
      name: "pluginHost:afterRender",
      priority: 50,
      handler: (frameCtx) => {
        const ctx = sceneCtxToPluginCtx(frameCtx);
        invokePluginField("afterRender", ctx);
        invokePluginField("afterPhysics", ctx);
      }
    });
  }

  function bindLifecycleBus(bus) {
    lifecycleBus = bus ?? null;
    if (lifecycleBus) {
      wireHostToBus(lifecycleBus);
    }
  }

  function warnDeprecated(method) {
    if (lifecycleBus) {
      log.warn(
        `[pluginHost] ${method}(ctx) is deprecated; lifecycle bus dispatches registered plugins automatically`
      );
    }
  }

  return {
    /**
     * @param {ThreeJsonPlugin} plugin
     */
    register(plugin) {
      if (!plugin || typeof plugin.name !== "string" || !plugin.name.trim()) {
        throw new Error("plugin must have a non-empty name");
      }
      plugins.push(plugin);
    },

    bindLifecycleBus,

    /** @param {PluginHostContext} ctx */
    async init(ctx) {
      warnDeprecated("init");
      for (let i = 0; i < plugins.length; i++) {
        const p = plugins[i];
        if (typeof p.init === "function") {
          await p.init(ctx);
        }
      }
    },

    dispose() {
      if (!lifecycleBus) {
        warnDeprecated("dispose");
      }
      for (let i = plugins.length - 1; i >= 0; i--) {
        try {
          plugins[i].dispose?.();
        } catch (_) {
          /* ignore */
        }
      }
      plugins.length = 0;
    },

    /** @param {PluginHostContext} ctx */
    beforeFrame(ctx) {
      warnDeprecated("beforeFrame");
      invokePluginField("beforeFrame", ctx);
    },

    /** @param {PluginHostContext} ctx */
    beforeRender(ctx) {
      warnDeprecated("beforeRender");
      invokePluginField("beforeRender", ctx);
    },

    /** @param {PluginHostContext} ctx */
    afterRender(ctx) {
      warnDeprecated("afterRender");
      invokePluginField("afterRender", ctx);
    },

    /** @param {PluginHostContext} ctx */
    beforePhysics(ctx) {
      warnDeprecated("beforePhysics");
      invokePluginField("beforePhysics", ctx);
    },

    /** @param {PluginHostContext} ctx */
    afterPhysics(ctx) {
      warnDeprecated("afterPhysics");
      invokePluginField("afterPhysics", ctx);
    }
  };
}

export { createPluginHost };

/**
 * Default ELM core binding executor — runs EventScript or raw JS from binding payload.
 */

import { log } from "../../util/logger.js";
import {
  resolveEventScriptMode,
  runEventScript,
  runJavaScriptEventScript
} from "./eventScript/index.js";
import { resolveBindingScriptText } from "./bindingPayload.js";

/**
 * @param {object} [options]
 * @returns {import("./eventListenerManager.js").CoreBindingExecutor}
 */
export function createCoreBindingExecutor(options = {}) {
  const sceneConfig = options.sceneConfig ?? null;
  const timerScheduler = options.timerScheduler ?? null;

  return async (dispatchCtx) => {
    const binding = dispatchCtx.binding;
    const payload = binding?.payload;
    if (payload && typeof payload === "object" && typeof payload.handler === "function") {
      await payload.handler(dispatchCtx);
      return;
    }

    const scriptText = resolveBindingScriptText(binding);
    if (!scriptText) {
      log.warn("[eventMechanism] core binding has no script or handler", {
        threeJsonId: dispatchCtx.threeJsonId,
        eventName: dispatchCtx.eventName,
        bindingId: binding?.id
      });
      return;
    }

    const activeSceneConfig =
      options.sceneConfig ?? dispatchCtx.sceneRuntime?.sceneConfig ?? dispatchCtx.sceneConfig ?? sceneConfig;
    const eventConfig =
      payload && typeof payload === "object" && payload.eventConfig && typeof payload.eventConfig === "object"
        ? payload.eventConfig
        : null;
    const mode = resolveEventScriptMode(activeSceneConfig, eventConfig);
    const runtimeOptions = {
      sceneConfig: activeSceneConfig,
      timerScheduler: timerScheduler ?? undefined,
      mutationOptions: options.mutationOptions
    };

    const scriptDispatchCtx = {
      ...dispatchCtx,
      scene: dispatchCtx.scene ?? dispatchCtx.sceneRuntime?.scene ?? null,
      camera: dispatchCtx.camera ?? dispatchCtx.sceneRuntime?.camera ?? null,
      renderer: dispatchCtx.renderer ?? dispatchCtx.sceneRuntime?.renderer ?? null,
      controls: dispatchCtx.controls ?? dispatchCtx.sceneRuntime?.controls ?? null,
      sceneConfig: runtimeOptions.sceneConfig
    };

    if (mode === "javascript") {
      await runJavaScriptEventScript(scriptText, scriptDispatchCtx, runtimeOptions);
      return;
    }
    await runEventScript(scriptText, scriptDispatchCtx, runtimeOptions);
  };
}

/**
 * Execute script bindings after domain bindings (§3.1.8).
 *
 * @param {import("./eventBindingRegistry.js").EventBindingEntry} binding
 * @param {object} dispatchCtx
 * @param {import("./eventListenerManager.js").CoreBindingExecutor|undefined} coreBindingExecutor
 */
export async function executeScriptBinding(binding, dispatchCtx, coreBindingExecutor) {
  const executor =
    typeof coreBindingExecutor === "function"
      ? coreBindingExecutor
      : createCoreBindingExecutor({ sceneConfig: dispatchCtx.sceneConfig });
  await executor({ ...dispatchCtx, binding });
}

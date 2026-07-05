/**
 * Raw JavaScript event runtime (sceneConfig opt-in, no sandbox).
 */

import { createScriptObjectHandle, resolveScriptObject } from "./scriptObjectHandle.js";
import { createTimerScheduler } from "./timerScheduler.js";
import { runEventScriptCommand } from "./runCommand.js";

/**
 * @param {string} source
 * @param {object} dispatchCtx
 * @param {object} [options]
 */
export async function runJavaScriptEventScript(source, dispatchCtx, options = {}) {
  const timerScheduler = options.timerScheduler ?? createTimerScheduler();
  const self = createScriptObjectHandle(dispatchCtx.object, {
    mutationOptions: options.mutationOptions
  });
  const ctx = {
    self,
    event: dispatchCtx.eventName ?? null,
    payload: dispatchCtx.nativeEvent ?? dispatchCtx.payload ?? null,
    scene: dispatchCtx.scene ?? dispatchCtx.sceneRuntime?.scene ?? null,
    threeJsonId: dispatchCtx.threeJsonId ?? null,
    ref(token) {
      return resolveScriptObject(token, { mutationOptions: options.mutationOptions });
    },
    wait(ms) {
      return timerScheduler.wait(ms);
    },
    runCommand(commandText) {
      return runEventScriptCommand(commandText, dispatchCtx, {
        sceneConfig: options.sceneConfig
      });
    }
  };

  try {
    const fn = new Function(
      "self",
      "event",
      "payload",
      "ctx",
      "ref",
      "wait",
      "runCommand",
      `"use strict";\nreturn (async () => {\n${source}\n})();`
    );
    await fn(ctx.self, ctx.event, ctx.payload, ctx, ctx.ref, ctx.wait, ctx.runCommand);
  } finally {
    if (options.disposeTimer !== false && options.timerScheduler == null) {
      timerScheduler.clearAll();
    }
  }
}

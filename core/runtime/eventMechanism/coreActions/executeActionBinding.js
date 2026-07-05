import { log } from "../../../util/logger.js";
import { resolveEventTarget } from "../resolveEventTarget.js";
import { normalizeEventActions } from "./actionPayload.js";
import { executeRegisteredEventAction } from "./actionRegistry.js";
import "./objectActions.js";

/**
 * @param {import("../eventBindingRegistry.js").EventBindingEntry} binding
 * @param {object} dispatchCtx
 */
export async function executeActionBinding(binding, dispatchCtx = {}) {
  const actions = normalizeEventActions(binding?.payload?.eventConfig ?? {});
  const baseCtx = {
    ...dispatchCtx,
    binding,
    actions,
    sourceBinding: binding,
    record: dispatchCtx.object?.userData?.objJson ?? null,
    object3D: dispatchCtx.object ?? null,
    ref: resolveEventTarget
  };
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    try {
      await executeRegisteredEventAction(action, baseCtx);
    } catch (error) {
      if (action?.continueOnError === true) {
        log.warn("[eventMechanism] action failed; continuing", {
          type: action?.type,
          threeJsonId: dispatchCtx.threeJsonId,
          eventName: dispatchCtx.eventName,
          error
        });
        continue;
      }
      throw error;
    }
  }
}

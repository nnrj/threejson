/**
 * Replay object.ready ELM bindings after bindSceneEventRuntime (batch load).
 */

import { getObjectByThreeJsonId } from "../../handler/objectRegistry.js";
import { getThreeJsonIdsWithBindingsForEvent } from "../eventMechanism/eventBindingRegistry.js";
import { notifyObjectReady } from "./objectLifecycleDispatch.js";
import { isLifecycleEligibleRecord } from "./objectLifecycleEligibility.js";

/**
 * Depth-first collect deploy records that have threeJsonId.
 * @param {unknown} records
 * @param {object[]} out
 */
function collectRecordsDepthFirst(records, out) {
  if (!Array.isArray(records)) {
    return;
  }
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record || typeof record !== "object") {
      continue;
    }
    if (isLifecycleEligibleRecord(record)) {
      out.push(record);
    }
    if (Array.isArray(record.subScene) && record.subScene.length > 0) {
      collectRecordsDepthFirst(record.subScene, out);
    }
  }
}

/**
 * @param {object} [options]
 * @param {object|null} [options.sceneJsonRoot]
 * @param {object[]|null} [options.objectList]
 * @param {import("./objectLifecycleDispatch.js").ObjectLifecycleContext|null} [options.objectLifecycle]
 */
export async function replayObjectReadyBindingsAfterBind(options = {}) {
  const boundIds = new Set(getThreeJsonIdsWithBindingsForEvent("object.ready"));
  if (boundIds.size === 0) {
    return;
  }

  const objectList =
    options.objectList ??
    options.sceneJsonRoot?.objectList ??
    options.sceneJsonRoot?.worldInfo?.objectList ??
    null;

  const ordered = [];
  collectRecordsDepthFirst(objectList, ordered);

  const lifecycleCtx = options.objectLifecycle ?? { callbacks: {}, elmDispatchEnabled: true };

  for (let i = 0; i < ordered.length; i++) {
    const record = ordered[i];
    const id = typeof record.threeJsonId === "string" ? record.threeJsonId.trim() : "";
    if (!id || !boundIds.has(id)) {
      continue;
    }
    if (!getObjectByThreeJsonId(id)) {
      continue;
    }
    await notifyObjectReady(record, lifecycleCtx, "replay");
  }
}

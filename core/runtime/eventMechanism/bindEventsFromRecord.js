/**
 * Bind platform events declared on userData.objJson.events (JSON persistence path).
 */

import { log } from "../../util/logger.js";
import { buildBindingMetadataFromObject } from "./bindingDescriptor.js";
import { addBinding } from "./eventBindingRegistry.js";
import {
  collectRejectedEventConfigs,
  getRejectedEventConfigReason,
  listValidEventEntries
} from "./eventRecordValidation.js";
import { isEventAllowedForObjType } from "./objTypeEventCapabilities.js";
import { resolveEventScriptSource } from "./resolveEventScriptSource.js";
import { normalizeEventActions } from "./coreActions/index.js";

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @param {object} [options]
 * @returns {Promise<string[]>} binding ids
 */
export async function bindEventsFromRecord(object3D, options = {}) {
  const manager = options.manager ?? null;
  const sceneToken = typeof options.sceneToken === "string" ? options.sceneToken.trim() : "";
  const metadata = buildBindingMetadataFromObject(object3D);
  if (!metadata) {
    return [];
  }
  const descriptor = object3D?.userData?.objJson;
  const eventsBlock = descriptor?.events;
  if (!eventsBlock || typeof eventsBlock !== "object") {
    return [];
  }

  for (const reason of collectRejectedEventConfigs(eventsBlock, metadata.threeJsonId)) {
    log.warn("[eventMechanism] rejected events config", { reason });
  }

  const bindingIds = [];
  const entries = listValidEventEntries(eventsBlock);
  for (let i = 0; i < entries.length; i++) {
    const { eventName, config } = entries[i];
    if (getRejectedEventConfigReason(config)) {
      continue;
    }
    if (!isEventAllowedForObjType(metadata.objType, eventName)) {
      log.warn("[eventMechanism] bindEventsFromRecord skipped: event not allowed for objType", {
        threeJsonId: metadata.threeJsonId,
        objType: metadata.objType,
        eventName
      });
      continue;
    }

    const actions = normalizeEventActions(config);
    const resolved = await resolveEventScriptSource(config, {
      threeJsonId: metadata.threeJsonId,
      eventName,
      sceneJsonRoot: options.sceneJsonRoot,
      assetLibrary: options.assetLibrary
    });
    if (!resolved && actions.length === 0) {
      continue;
    }

    if (metadata.executorKind === "domain" && (resolved || actions.length > 0)) {
      log.warn("[eventMechanism] domain object has json event payload; domain executeBoundEvent runs before actions/script (§3.1.8)", {
        threeJsonId: metadata.threeJsonId,
        domainKey: metadata.domainKey,
        eventName
      });
    }

    const entry = addBinding({
      threeJsonId: metadata.threeJsonId,
      eventName,
      source: "json",
      objType: metadata.objType,
      domainKey: metadata.domainKey,
      executorKind: metadata.executorKind,
      payload: {
        actions,
        scriptSource: resolved,
        scriptText: resolved?.source ?? "",
        eventConfig: config
      },
      sceneToken: sceneToken || undefined
    });
    if (!entry) {
      continue;
    }
    manager?.notifyBindingAdded(eventName);
    bindingIds.push(entry.id);
  }

  return bindingIds;
}

/**
 * @param {import("three").Scene|import("three").Object3D|null|undefined} scene
 * @param {object} [options]
 * @returns {Promise<string[]>}
 */
export async function bindEventsFromScene(scene, options = {}) {
  if (!scene || typeof scene.traverse !== "function") {
    return [];
  }
  const bindingIds = [];
  const tasks = [];
  scene.traverse((object) => {
    if (!object || object === scene) {
      return;
    }
    tasks.push(
      bindEventsFromRecord(object, options).then((ids) => {
        bindingIds.push(...ids);
      })
    );
  });
  await Promise.all(tasks);
  return bindingIds;
}

/**
 * Wire infoPanel dismissTrigger bindings (core builtin, runtime-only).
 */

import { applyObjectVisibility } from "../../handler/objectVisibility.js";
import { addBinding, getBindings, removeBinding } from "./eventBindingRegistry.js";
import {
  dismissTriggerToPlatformEvent,
  resolveInfoPanelDismissTrigger
} from "./infoPanelDismissTrigger.js";
import { buildBindingMetadataFromObject } from "./bindingDescriptor.js";

function hasDismissBinding(threeJsonId, eventName, sceneToken, runtimeScope) {
	const bindings = getBindings(threeJsonId, eventName, runtimeScope);
	return bindings.some((binding) => {
		const payload = binding?.payload;
		return payload && typeof payload === "object" &&
			payload.builtin === "infoPanel.dismiss" &&
			(!sceneToken || binding.sceneToken === sceneToken);
	});
}

/**
 * @param {string} threeJsonId
 * @param {string} sceneToken
 * @param {object|null|undefined} manager
 * @param {*} [runtimeScope]
 */
function removeDismissBindingsForPanel(threeJsonId, sceneToken, manager, runtimeScope) {
	const bindings = getBindings(threeJsonId, undefined, runtimeScope);
	const removedEvents = new Set();
	for (let i = 0; i < bindings.length; i++) {
		const binding = bindings[i];
		if (binding?.payload?.builtin !== "infoPanel.dismiss") {
			continue;
		}
		if (sceneToken && binding.sceneToken !== sceneToken) {
			continue;
		}
		const removed = removeBinding(binding.id, runtimeScope);
		if (removed) {
			removedEvents.add(removed.eventName);
		}
	}
	for (const eventName of removedEvents) {
		manager?.notifyBindingRemoved?.(eventName);
	}
}

export function bindDismissTriggerForPanel(object3D, manager, sceneToken, runtimeScope) {
  const metadata = buildBindingMetadataFromObject(object3D);
  if (!metadata || metadata.objType !== "infopanel") {
    return [];
  }
  const descriptor = object3D.userData?.objJson;
  const trigger = resolveInfoPanelDismissTrigger(descriptor, {
    threeJsonId: metadata.threeJsonId
  });
  const eventName = dismissTriggerToPlatformEvent(trigger);
  if (!eventName) {
    return [];
  }
  const scope = runtimeScope ?? object3D;
  if (hasDismissBinding(metadata.threeJsonId, eventName, sceneToken, scope)) {
    return [];
  }

  const entry = addBinding({
    threeJsonId: metadata.threeJsonId,
    eventName,
    source: "runtime",
    objType: metadata.objType,
    domainKey: metadata.domainKey,
    executorKind: "core",
    payload: {
      builtin: "infoPanel.dismiss",
      handler: async (ctx) => {
        const target = ctx.object ?? object3D;
        if (!target) {
          return;
        }
        applyObjectVisibility(target, false, { applyToSubtree: false });
        if (descriptor && typeof descriptor === "object") {
          descriptor.visible = false;
        }
      }
    },
    sceneToken
  }, scope);
  if (!entry) {
    return [];
  }
  manager?.notifyBindingAdded(eventName);
  return [entry.id];
}

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @param {object} options
 * @param {object} options.manager
 * @param {string} [options.sceneToken]
 * @param {*} [options.runtimeScope]
 * @returns {string[]}
 */
export function wireInfoPanelDismissTriggerForObject(object3D, options = {}) {
  const manager = options.manager ?? null;
  const sceneToken = typeof options.sceneToken === "string" ? options.sceneToken.trim() : "";
  const scope = options.runtimeScope ?? object3D;
  if (!object3D || !manager) {
    return [];
  }
  const metadata = buildBindingMetadataFromObject(object3D);
  if (metadata?.threeJsonId) {
    removeDismissBindingsForPanel(metadata.threeJsonId, sceneToken, manager, scope);
  }
  return bindDismissTriggerForPanel(object3D, manager, sceneToken, scope);
}

/**
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object} options
 * @param {object} options.manager
 * @param {string} [options.sceneToken]
 * @param {*} [options.runtimeScope]
 * @returns {Promise<string[]>}
 */
export async function wireInfoPanelDismissTriggers(scene, options = {}) {
  const manager = options.manager ?? null;
  const sceneToken = typeof options.sceneToken === "string" ? options.sceneToken.trim() : "";
  const scope = options.runtimeScope ?? scene;
  if (!scene || typeof scene.traverse !== "function" || !manager) {
    return [];
  }

  /** @type {string[]} */
  const bindingIds = [];
  let needsEscapeDismiss = false;

  scene.traverse((object) => {
    if (!object || object === scene) {
      return;
    }
    const descriptor = object.userData?.objJson;
    if (!descriptor || String(descriptor.objType || "").toLowerCase() !== "infopanel") {
      return;
    }
    const trigger = resolveInfoPanelDismissTrigger(descriptor, {
      threeJsonId: descriptor.threeJsonId
    });
    if (trigger === "keydown") {
      needsEscapeDismiss = true;
      return;
    }
    bindingIds.push(...bindDismissTriggerForPanel(object, manager, sceneToken, scope));
  });

  if (needsEscapeDismiss) {
    const registered = manager.registerGlobalListener("keydown", async (ctx) => {
      const key = ctx.nativeEvent?.key;
      if (key !== "Escape") {
        return;
      }
      ctx.nativeEvent?.preventDefault?.();
      scene.traverse((object) => {
        if (!object?.visible) {
          return;
        }
        const descriptor = object.userData?.objJson;
        if (!descriptor || String(descriptor.objType || "").toLowerCase() !== "infopanel") {
          return;
        }
        if (resolveInfoPanelDismissTrigger(descriptor) !== "keydown") {
          return;
        }
        applyObjectVisibility(object, false, { applyToSubtree: false });
        descriptor.visible = false;
      });
    });
    if (registered) {
      manager.notifyBindingAdded("keydown");
    }
  }

  return bindingIds;
}

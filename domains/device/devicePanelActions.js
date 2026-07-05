import { getObjectByThreeJsonId } from "../../core/handler/objectRegistry.js";
import {
  addBinding,
  buildBindingMetadataFromObject,
  getBindings,
  isEventAllowedForObjType,
  isPlatformEventName,
  registerEventAction,
  wireInfoPanelDismissTriggerForObject
} from "../../core/runtime/eventMechanism/index.js";
import { log } from "../../core/util/logger.js";
import {
  ensureDevicePanelDeployed,
  hideDevicePanel,
  resolveDevicePanelRefFromRoot,
  showDevicePanel,
  toggleDevicePanel
} from "./devicePanelRuntime.js";
import { hasDevicePanelBinding, resolveDevicePanelBehaviorConfig } from "./devicePanelResolver.js";

let registered = false;
const hideTimers = new WeakMap();

function hasOwn(record, key) {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}

function resolveDeviceRoot(action, ctx) {
  if (!action || action.target == null || action.target === "" || action.target === "self") {
    return ctx.object3D ?? ctx.object ?? null;
  }
  const target = String(action.target || "").trim();
  if (!target) {
    return ctx.object3D ?? ctx.object ?? null;
  }
  return ctx.ref?.(target) ?? null;
}

function getScene(ctx) {
  return ctx.scene ?? ctx.sceneRuntime?.scene ?? null;
}

function normalizeSceneToken(ctx) {
  return typeof ctx.sceneToken === "string" && ctx.sceneToken.trim()
    ? ctx.sceneToken.trim()
    : (typeof ctx.binding?.sceneToken === "string" ? ctx.binding.sceneToken.trim() : "");
}

function wirePanelDismissIfNeeded(panelId, ctx) {
  const panel = panelId ? getObjectByThreeJsonId(panelId) : null;
  if (!panel) {
    return;
  }
  wireInfoPanelDismissTriggerForObject(panel, {
    manager: ctx.manager,
    sceneToken: normalizeSceneToken(ctx)
  });
}

function clearPanelHideTimer(root) {
  const timer = root ? hideTimers.get(root) : null;
  if (timer != null) {
    clearTimeout(timer);
    hideTimers.delete(root);
  }
}

function hidePanelWithDelay(root, delayMs) {
  if (!root) {
    return;
  }
  clearPanelHideTimer(root);
  const delay = Number(delayMs);
  if (!Number.isFinite(delay) || delay <= 0) {
    hideDevicePanel(root);
    return;
  }
  const timer = setTimeout(() => {
    hideTimers.delete(root);
    hideDevicePanel(root);
  }, delay);
  hideTimers.set(root, timer);
}

async function ensurePanelReady(scene, root, ctx) {
  if (!scene || !root) {
    return null;
  }
  const panelId = await ensureDevicePanelDeployed(scene, root);
  wirePanelDismissIfNeeded(panelId, ctx);
  maybeBindPanelSelfHideTrigger(root, ctx);
  return panelId;
}

/** After lazy deploy, bind panelHideTrigger panel.click|panel.dblclick when panel was missing at scene bind. */
function maybeBindPanelSelfHideTrigger(deviceRoot, ctx = {}) {
  const record = deviceRoot?.userData?.objJson;
  if (!record || !hasDevicePanelBinding(record)) {
    return null;
  }
  const behavior = resolveDevicePanelBehaviorConfig(record);
  if (!behavior.hasExplicitPanelHideTrigger || !behavior.hideFromPanel || behavior.hasExplicitPanelDismissTrigger) {
    return null;
  }
  const panelEvent = mapPanelTriggerToEventName(behavior.hide);
  if (!panelEvent) {
    return null;
  }
  const panelId = resolveDevicePanelRefFromRoot(deviceRoot);
  if (!panelId || !getObjectByThreeJsonId(panelId)) {
    return null;
  }
  if (getBindings(panelId, panelEvent).length > 0) {
    return null;
  }
  return bindPanelSelfAction(deviceRoot, panelEvent, "device.hidePanel", ctx);
}

function mapDeviceTriggerToEventName(trigger) {
  if (trigger === "hover") {
    return "pointerover";
  }
  if (trigger === "mouseleave") {
    return "pointerout";
  }
  if (trigger === "click" || trigger === "dblclick" || trigger === "pointerdown" || trigger === "pointerup") {
    return trigger;
  }
  return "";
}

function mapPanelTriggerToEventName(trigger) {
  if (trigger === "panel.click") {
    return "click";
  }
  if (trigger === "panel.dblclick") {
    return "dblclick";
  }
  return "";
}

function bindCoreActionToObject(object3D, eventName, action, ctx = {}) {
  const metadata = buildBindingMetadataFromObject(object3D);
  if (!metadata) {
    return null;
  }
  if (!isPlatformEventName(eventName) || !isEventAllowedForObjType(metadata.objType, eventName)) {
    log.warn("[device] panel trigger skipped: unsupported platform event", {
      eventName,
      threeJsonId: metadata.threeJsonId,
      objType: metadata.objType
    });
    return null;
  }
  const entry = addBinding({
    threeJsonId: metadata.threeJsonId,
    eventName,
    source: "runtime",
    objType: metadata.objType,
    domainKey: metadata.domainKey,
    executorKind: "core",
    payload: {
      actions: [action],
      eventConfig: {
        action
      }
    },
    sceneToken: ctx.sceneToken
  });
  if (!entry) {
    return null;
  }
  ctx.manager?.notifyBindingAdded?.(eventName);
  return entry.id;
}

export function registerDevicePanelActions() {
  if (registered) {
    return;
  }
  registered = true;

  registerEventAction("device.showPanel", async (action, ctx) => {
    const root = resolveDeviceRoot(action, ctx);
    const scene = getScene(ctx);
    clearPanelHideTimer(root);
    await ensurePanelReady(scene, root, ctx);
    if (!showDevicePanel(root, true)) {
      throw new Error("[device] device.showPanel failed");
    }
  });

  registerEventAction("device.hidePanel", (action, ctx) => {
    const root = resolveDeviceRoot(action, ctx);
    if (!root) {
      log.warn("[device] device.hidePanel skipped: target not found");
      return;
    }
    hidePanelWithDelay(root, action?.delayMs);
  });

  registerEventAction("device.togglePanel", async (action, ctx) => {
    const root = resolveDeviceRoot(action, ctx);
    const scene = getScene(ctx);
    if (!scene || !root) {
      throw new Error("[device] device.togglePanel requires scene and target");
    }
    clearPanelHideTimer(root);
    await ensurePanelReady(scene, root, ctx);
    const ok = await toggleDevicePanel(scene, root);
    if (!ok) {
      throw new Error("[device] device.togglePanel failed");
    }
  });
}

function bindPanelAction(deviceRoot, eventName, actionType, ctx = {}, actionOptions = {}) {
  return bindCoreActionToObject(deviceRoot, eventName, {
    type: actionType,
    target: "self",
    ...actionOptions
  }, ctx);
}

function bindPanelSelfAction(root, eventName, actionType, ctx = {}) {
  const panelId = resolveDevicePanelRefFromRoot(root);
  const panel = panelId ? getObjectByThreeJsonId(panelId) : null;
  if (!panel) {
    return null;
  }
  const panelRecord = panel.userData?.objJson;
  if (panelRecord && Object.prototype.hasOwnProperty.call(panelRecord, "dismissTrigger")) {
    return null;
  }
  if (!isPlatformEventName(eventName)) {
    log.warn("[device] panel self trigger skipped: unsupported platform event", {
      eventName,
      threeJsonId: panelId
    });
    return null;
  }
  const deviceId = root?.userData?.objJson?.threeJsonId;
  return bindCoreActionToObject(panel, eventName, {
    type: actionType,
    target: deviceId || "self"
  }, ctx);
}

export function bindDevicePanelActionTriggers(scene, ctx = {}) {
  registerDevicePanelActions();
  if (!scene || typeof scene.traverse !== "function") {
    return [];
  }
  const bindingIds = [];
  scene.traverse((root) => {
    const record = root?.userData?.objJson;
    if (!record || !hasDevicePanelBinding(record)) {
      return;
    }
    const behavior = resolveDevicePanelBehaviorConfig(record);
    const hasShow = behavior.hasExplicitPanelShowTrigger;
    const hasHide = behavior.hasExplicitPanelHideTrigger;
    if (!hasShow && !hasHide) {
      return;
    }
    const explicitEvents = record.events && typeof record.events === "object" ? record.events : {};
    const showEvent = mapDeviceTriggerToEventName(behavior.show);
    const hideEvent = mapDeviceTriggerToEventName(behavior.hide);
    if (hasShow && hasHide && showEvent && showEvent === hideEvent && behavior.show !== "none") {
      if (!explicitEvents[showEvent]) {
        const id = bindPanelAction(root, showEvent, "device.togglePanel", ctx);
        if (id) bindingIds.push(id);
      } else {
        log.warn("[device] panel trigger skipped: explicit events wins", { trigger: showEvent });
      }
      return;
    }
    if (hasShow && showEvent) {
      if (!explicitEvents[showEvent]) {
        const id = bindPanelAction(root, showEvent, "device.showPanel", ctx);
        if (id) bindingIds.push(id);
      } else {
        log.warn("[device] panelShowTrigger skipped: explicit events wins", { trigger: showEvent });
      }
    }
    if (hasHide && hideEvent) {
      if (!explicitEvents[hideEvent]) {
        const actionOptions = behavior.hide === "mouseleave" ? { delayMs: behavior.hideDelayMs } : {};
        const id = bindPanelAction(root, hideEvent, "device.hidePanel", ctx, actionOptions);
        if (id) bindingIds.push(id);
      } else {
        log.warn("[device] panelHideTrigger skipped: explicit events wins", { trigger: hideEvent });
      }
    }
    if (hasHide && behavior.hideFromPanel && !behavior.hasExplicitPanelDismissTrigger) {
      const panelEvent = mapPanelTriggerToEventName(behavior.hide);
      if (panelEvent) {
        const id = bindPanelSelfAction(root, panelEvent, "device.hidePanel", ctx);
        if (id) bindingIds.push(id);
      }
    }
  });
  scene.traverse((root) => {
    const record = root?.userData?.objJson;
    if (!record || !hasDevicePanelBinding(record)) {
      return;
    }
    const panelId = resolveDevicePanelRefFromRoot(root);
    if (panelId && getObjectByThreeJsonId(panelId)) {
      wirePanelDismissIfNeeded(panelId, ctx);
    }
  });
  return bindingIds;
}

registerDevicePanelActions();

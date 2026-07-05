import {
  addBinding,
  buildBindingMetadataFromObject,
  isEventAllowedForObjType,
  isPlatformEventName,
  registerEventAction,
  registerObjTypeEventCapabilities
} from "../../core/runtime/eventMechanism/index.js";
import { log } from "../../core/util/logger.js";
import { isDoorDescriptor } from "./doorDescriptor.js";
import { openOrCloseDoor, resolveDoorForAnimation } from "./doorKinematics.js";
import {
  isCabinetDeployRootRecord,
  mapDoorTriggerToEventName,
  resolveDoorToggleTrigger,
  shouldBindDoorToggle
} from "./doorTriggerResolver.js";

/** Document event after ELM/host door.toggle (room-show menu label sync). */
export const DOOR_TOGGLED_EVENT = "threejson:door-toggled";

const DOOR_INTERACTION_EVENTS = Object.freeze([
  "click",
  "dblclick",
  "pointerdown",
  "pointerup",
  "pointerover",
  "pointerout",
  "keydown",
  "keyup"
]);

let registered = false;
let capabilitiesRegistered = false;

function ensureDoorObjTypeCapabilities() {
  if (capabilitiesRegistered) {
    return;
  }
  capabilitiesRegistered = true;
  registerObjTypeEventCapabilities("door", DOOR_INTERACTION_EVENTS);
}

function resolveDoorRoot(action, ctx) {
  if (!action || action.target == null || action.target === "" || action.target === "self") {
    return ctx.object3D ?? ctx.object ?? null;
  }
  const target = String(action.target || "").trim();
  if (!target) {
    return ctx.object3D ?? ctx.object ?? null;
  }
  return ctx.ref?.(target) ?? null;
}

function notifyDoorToggled() {
  if (typeof document === "undefined" || typeof document.dispatchEvent !== "function") {
    return;
  }
  document.dispatchEvent(new CustomEvent(DOOR_TOGGLED_EVENT));
}

function bindCoreActionToObject(object3D, eventName, action, ctx = {}) {
  const metadata = buildBindingMetadataFromObject(object3D);
  if (!metadata) {
    return null;
  }
  if (!isPlatformEventName(eventName) || !isEventAllowedForObjType(metadata.objType, eventName)) {
    log.warn("[door] toggle trigger skipped: unsupported platform event", {
      eventName,
      threeJsonId: metadata.threeJsonId,
      objType: metadata.objType
    });
    return null;
  }
  const sceneToken =
    typeof ctx.sceneToken === "string" && ctx.sceneToken.trim()
      ? ctx.sceneToken.trim()
      : (typeof ctx.binding?.sceneToken === "string" ? ctx.binding.sceneToken.trim() : "");
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
    sceneToken
  });
  if (!entry) {
    return null;
  }
  ctx.manager?.notifyBindingAdded?.(eventName);
  return entry.id;
}

export function registerDoorEventActions() {
  if (registered) {
    return;
  }
  registered = true;
  ensureDoorObjTypeCapabilities();

  registerEventAction("door.toggle", (action, ctx) => {
    const root = resolveDoorRoot(action, ctx);
    const resolved = root ? resolveDoorForAnimation(root) : null;
    if (!root) {
      log.warn("[door] door.toggle skipped: target not found");
      return;
    }
    if (!resolved) {
      log.warn("[door] door.toggle skipped: not a door target");
      return;
    }
    openOrCloseDoor(root);
    notifyDoorToggled();
  });
}

function shouldSkipDerivedBind(record, eventName) {
  const explicitEvents = record?.events && typeof record.events === "object" ? record.events : {};
  return Boolean(explicitEvents[eventName]);
}

/**
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object} [ctx]
 * @returns {string[]}
 */
export function bindDoorActionTriggers(scene, ctx = {}) {
  registerDoorEventActions();
  if (!scene || typeof scene.traverse !== "function") {
    return [];
  }
  const bindingIds = [];
  const seenThreeJsonIds = new Set();
  scene.traverse((object3D) => {
    const record = object3D?.userData?.objJson;
    if (!record || !isDoorDescriptor(record) || isCabinetDeployRootRecord(record)) {
      return;
    }
    if (!shouldBindDoorToggle(record)) {
      return;
    }
    const trigger = resolveDoorToggleTrigger(record);
    const eventName = mapDoorTriggerToEventName(trigger);
    if (!eventName) {
      return;
    }
    if (shouldSkipDerivedBind(record, eventName)) {
      return;
    }
    const metadata = buildBindingMetadataFromObject(object3D);
    const id = metadata?.threeJsonId;
    if (!id || seenThreeJsonIds.has(id)) {
      return;
    }
    const bindingId = bindCoreActionToObject(object3D, eventName, {
      type: "door.toggle",
      target: "self"
    }, ctx);
    if (bindingId) {
      seenThreeJsonIds.add(id);
      bindingIds.push(bindingId);
    }
  });
  return bindingIds;
}

registerDoorEventActions();

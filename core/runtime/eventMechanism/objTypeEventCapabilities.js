/**
 * objType → supported platform event subset (core registry; not sceneConfig).
 */

import { isPlatformEventName, normalizePlatformEventName } from "./platformEvents.js";
import { isLifecycleEligibleObjType } from "../objectLifecycle/objectLifecycleEligibility.js";

/** @readonly */
const LIFECYCLE_PLATFORM_EVENTS = Object.freeze(["object.ready", "object.dispose"]);

/** @type {Map<string, ReadonlySet<string>>} */
const capabilitiesByObjType = new Map();

/** @readonly */
const DEFAULT_INTERACTION_EVENTS = Object.freeze([
  "click",
  "dblclick",
  "pointerdown",
  "pointerup",
  "pointerover",
  "pointerout"
]);

/** @readonly */
const DEFAULT_KEYBOARD_EVENTS = Object.freeze(["keydown", "keyup"]);

/** @readonly */
const DEFAULT_SCENE_EVENTS = Object.freeze(["scene.ready", "scene.dispose"]);

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function freezeEventSet(eventNames) {
  const out = new Set();
  for (let i = 0; i < eventNames.length; i++) {
    const name = normalizePlatformEventName(eventNames[i]);
    if (isPlatformEventName(name)) {
      out.add(name);
    }
  }
  return Object.freeze(out);
}

/**
 * @param {string} objType
 * @param {readonly string[]} eventNames
 */
export function registerObjTypeEventCapabilities(objType, eventNames) {
  const key = normalizeObjType(objType);
  if (!key) {
    throw new Error("[eventMechanism] registerObjTypeEventCapabilities requires objType");
  }
  if (!Array.isArray(eventNames)) {
    throw new Error("[eventMechanism] registerObjTypeEventCapabilities requires eventNames array");
  }
  capabilitiesByObjType.set(key, freezeEventSet(eventNames));
}

/**
 * @param {unknown} objType
 * @returns {readonly string[]}
 */
export function listObjTypeEventCapabilities(objType) {
  const key = normalizeObjType(objType);
  const set = key ? capabilitiesByObjType.get(key) : null;
  const out = set ? Array.from(set) : [];
  if (isLifecycleEligibleObjType(key)) {
    for (let i = 0; i < LIFECYCLE_PLATFORM_EVENTS.length; i++) {
      const name = LIFECYCLE_PLATFORM_EVENTS[i];
      if (!out.includes(name)) {
        out.push(name);
      }
    }
  }
  return out;
}

/**
 * @param {unknown} objType
 * @param {unknown} eventName
 * @returns {boolean}
 */
export function isEventAllowedForObjType(objType, eventName) {
  const key = normalizeObjType(objType);
  const eventKey = normalizePlatformEventName(eventName);
  if (!key || !isPlatformEventName(eventKey)) {
    return false;
  }
  if (eventKey === "object.ready" || eventKey === "object.dispose") {
    return isLifecycleEligibleObjType(key);
  }
  const set = capabilitiesByObjType.get(key);
  return set ? set.has(eventKey) : false;
}

/**
 * Seed common objTypes used by plain objects and domain deploy roots.
 */
function seedDefaultCapabilities() {
  const interaction = [...DEFAULT_INTERACTION_EVENTS, ...DEFAULT_KEYBOARD_EVENTS];
  const contentEvents = [...interaction, ...DEFAULT_SCENE_EVENTS];
  registerObjTypeEventCapabilities("scene", DEFAULT_SCENE_EVENTS);
  registerObjTypeEventCapabilities("camera", DEFAULT_SCENE_EVENTS);
  registerObjTypeEventCapabilities("light", DEFAULT_SCENE_EVENTS);
  registerObjTypeEventCapabilities("box", contentEvents);
  registerObjTypeEventCapabilities("group", contentEvents);
  registerObjTypeEventCapabilities("native", contentEvents);
  registerObjTypeEventCapabilities("mesh", contentEvents);
  registerObjTypeEventCapabilities("sphere", contentEvents);
  registerObjTypeEventCapabilities("ring", contentEvents);
  registerObjTypeEventCapabilities("infopanel", [...contentEvents, "keydown"]);
  registerObjTypeEventCapabilities("domain", [...interaction, ...DEFAULT_SCENE_EVENTS]);
}

seedDefaultCapabilities();

/** @param {Map<string, ReadonlySet<string>>|null} [snapshot] */
export function _resetObjTypeEventCapabilitiesForTests(snapshot = null) {
  capabilitiesByObjType.clear();
  if (snapshot) {
    for (const [key, value] of snapshot.entries()) {
      capabilitiesByObjType.set(key, value);
    }
    return;
  }
  seedDefaultCapabilities();
}

/** @returns {Map<string, ReadonlySet<string>>} */
export function _snapshotObjTypeEventCapabilitiesForTests() {
  return new Map(capabilitiesByObjType);
}

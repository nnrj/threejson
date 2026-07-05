/**
 * Default ELM host: raycast canvas → threeJsonId for platform event dispatch.
 */

import * as THREE from "three";
import { getBindings } from "./eventBindingRegistry.js";
import { normalizePlatformEventName } from "./platformEvents.js";

function normalizeObjType(descriptor) {
  return typeof descriptor?.objType === "string"
    ? descriptor.objType.trim().toLowerCase()
    : (typeof descriptor?.type === "string" ? descriptor.type.trim().toLowerCase() : "");
}

/**
 * @param {object|null|undefined} descriptor
 * @returns {boolean}
 */
function readPickThroughRaycast(descriptor) {
  return Boolean(descriptor && descriptor.pickThroughRaycast === true);
}

/**
 * Nearest ancestor (excluding self) with pickThroughRaycast on objJson.
 * @param {import("three").Object3D|null|undefined} object
 * @returns {import("three").Object3D|null}
 */
export function findPickThroughRaycastAncestor(object) {
  let node = object?.parent ?? null;
  while (node) {
    if (readPickThroughRaycast(node.userData?.objJson)) {
      return node;
    }
    node = node.parent ?? null;
  }
  return null;
}

/**
 * Nearest self or ancestor Object3D whose objJson declares pickThroughRaycast.
 * @param {import("three").Object3D|null|undefined} object
 * @returns {import("three").Object3D|null}
 */
export function findPickThroughRaycastRoot(object) {
  if (readPickThroughRaycast(object?.userData?.objJson)) {
    return object ?? null;
  }
  return findPickThroughRaycastAncestor(object);
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @returns {boolean}
 */
export function hasPickThroughRaycastAncestor(object) {
  return findPickThroughRaycastRoot(object) != null;
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @param {import("three").Object3D|null|undefined} ancestor
 * @returns {boolean}
 */
function isDescendantOfObject(object, ancestor) {
  if (!object || !ancestor) {
    return false;
  }
  let node = object;
  while (node) {
    if (node === ancestor) {
      return true;
    }
    node = node.parent ?? null;
  }
  return false;
}

/**
 * @param {import("three").Intersection[]} intersects
 * @param {string|null|undefined} eventName
 * @param {(object: import("three").Object3D|null, eventName?: string|null) => string|null|undefined} resolveFromObject
 * @returns {import("three").Object3D|null}
 */
export function pickObjectFromIntersectsForEvent(intersects, eventName, resolveFromObject) {
  if (!Array.isArray(intersects) || intersects.length === 0) {
    return null;
  }
  const eventKey = typeof eventName === "string" ? normalizePlatformEventName(eventName) : "";
  if (!eventKey) {
    return intersects[0].object ?? null;
  }

  /** @type {import("three").Object3D|null} */
  let activePickThroughRoot = null;
  /** @type {import("three").Object3D|null} */
  let firstInsidePickThrough = null;

  for (let i = 0; i < intersects.length; i++) {
    const candidate = intersects[i]?.object ?? null;
    if (!candidate) {
      continue;
    }

    if (activePickThroughRoot && !isDescendantOfObject(candidate, activePickThroughRoot)) {
      return firstInsidePickThrough ?? intersects[0].object ?? null;
    }

    const id = resolveFromObject(candidate, eventName);
    const hasBinding =
      typeof id === "string" && id.trim() && getBindings(id.trim(), eventKey).length > 0;

    if (hasBinding) {
      if (activePickThroughRoot && !isDescendantOfObject(candidate, activePickThroughRoot)) {
        return firstInsidePickThrough ?? intersects[0].object ?? null;
      }
      return candidate;
    }

    if (readPickThroughRaycast(candidate.userData?.objJson)) {
      continue;
    }

    const containerPickThroughRoot = findPickThroughRaycastAncestor(candidate);
    if (containerPickThroughRoot) {
      if (!activePickThroughRoot) {
        activePickThroughRoot = containerPickThroughRoot;
        firstInsidePickThrough = candidate;
      }
      if (isDescendantOfObject(candidate, activePickThroughRoot)) {
        continue;
      }
    }

    return candidate;
  }

  if (firstInsidePickThrough) {
    return firstInsidePickThrough;
  }
  for (let i = 0; i < intersects.length; i++) {
    const candidate = intersects[i]?.object ?? null;
    if (!candidate) {
      continue;
    }
    if (readPickThroughRaycast(candidate.userData?.objJson)) {
      continue;
    }
    return candidate;
  }
  return null;
}

/**
 * Walk pick chain: prefer infoPanel, then binding target for event, then domain root.
 * @param {import("three").Object3D|null|undefined} object
 * @param {string|null|undefined} [eventName]
 * @returns {string|null}
 */
export function resolveThreeJsonIdFromPick(object, eventName) {
  const chain = [];
  let node = object ?? null;
  while (node) {
    const descriptor = node.userData?.objJson;
    const id = typeof descriptor?.threeJsonId === "string" ? descriptor.threeJsonId.trim() : "";
    if (id) {
      chain.push({
        id,
        objType: normalizeObjType(descriptor),
        domain: typeof descriptor?.domain === "string" ? descriptor.domain.trim() : ""
      });
    }
    node = node.parent ?? null;
  }
  if (chain.length === 0) {
    return null;
  }

  const eventKey = typeof eventName === "string" ? normalizePlatformEventName(eventName) : "";
  if (eventKey) {
    for (let i = 0; i < chain.length; i++) {
      if (getBindings(chain[i].id, eventKey).length > 0) {
        return chain[i].id;
      }
    }
  }

  const infoPanelHit = chain.find((entry) => entry.objType === "infopanel");
  const infoPanelHoverOnly =
    !eventKey || eventKey === "pointerover" || eventKey === "pointerout";
  if (infoPanelHit && infoPanelHoverOnly) {
    return infoPanelHit.id;
  }

  const domainHit = chain.find((entry) => entry.objType === "domain" && entry.domain);
  if (domainHit) {
    return domainHit.id;
  }

  return chain[0].id;
}

/**
 * @param {object} options
 * @param {HTMLElement|null|undefined} options.canvas
 * @param {import("three").Camera|null|undefined} options.camera
 * @param {import("three").Scene|import("three").Object3D|null|undefined} options.scene
 * @param {object|null|undefined} [options.sceneRuntime]
 * @param {object|null|undefined} [options.manager]
 * @param {string} [options.sceneToken]
 * @param {(object: import("three").Object3D|null, eventName?: string|null) => string|null|undefined} [options.resolveThreeJsonIdFromObject]
 * @returns {import("./eventListenerManager.js").EventListenerHost|null}
 */
export function createCanvasRaycastEventHost(options = {}) {
  const canvas = options.canvas ?? null;
  const getCamera = () => options.camera ?? options.sceneRuntime?.camera ?? null;
  const getScene = () => options.scene ?? options.sceneRuntime?.scene ?? null;
  const resolveFromObject =
    typeof options.resolveThreeJsonIdFromObject === "function"
      ? options.resolveThreeJsonIdFromObject
      : resolveThreeJsonIdFromPick;
  let hoverThreeJsonId = "";
  /** @type {import("three").Object3D|null} */
  let lastPickedObject = null;

  if (!canvas) {
    return null;
  }

  function getEventMechanismHandle() {
    const runtime = options.sceneRuntime ?? null;
    if (!runtime || typeof runtime !== "object") {
      return null;
    }
    return runtime.eventMechanism ?? null;
  }

  function getDispatchContext() {
    const eventHandle = getEventMechanismHandle();
    const manager = options.manager ?? eventHandle?.manager ?? null;
    const sceneTokenRaw = options.sceneToken ?? eventHandle?.sceneToken;
    const sceneToken = typeof sceneTokenRaw === "string" ? sceneTokenRaw.trim() : "";
    return {
      scene: getScene(),
      camera: getCamera(),
      sceneRuntime: options.sceneRuntime ?? null,
      manager,
      object: lastPickedObject,
      ...(sceneToken ? { sceneToken } : {})
    };
  }

  function isCanvasPickEvent(nativeEvent) {
    if (!canvas || !nativeEvent || typeof canvas.getBoundingClientRect !== "function") {
      return true;
    }
    const rect = canvas.getBoundingClientRect();
    const x = nativeEvent.clientX;
    const y = nativeEvent.clientY;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function resolvePickId(eventName, nativeEvent) {
    const camera = getCamera();
    const scene = getScene();
    if (!camera || !scene || !nativeEvent) {
      lastPickedObject = null;
      return null;
    }
    const picked = pickObjectFromNativeEvent(nativeEvent, canvas, camera, scene, {
      eventName,
      resolveFromObject
    });
    lastPickedObject = picked ?? null;
    const id = resolveFromObject(picked, eventName);
    return typeof id === "string" && id.trim() ? id.trim() : null;
  }

  return {
    canvas,
    document: typeof document !== "undefined" ? document : null,
    getDispatchContext,
    isCanvasPickEvent,
    resolvePickThreeJsonId(eventName, nativeEvent) {
      return resolvePickId(eventName, nativeEvent);
    },
    createPointerHoverListener(manager) {
      if (!manager || typeof manager.dispatchPlatformEvent !== "function") {
        return null;
      }
      const onPointerMove = (nativeEvent) => {
        const nextId = resolvePickId("pointerover", nativeEvent) || "";
        if (nextId === hoverThreeJsonId) {
          return;
        }
        const prevId = hoverThreeJsonId;
        hoverThreeJsonId = nextId;
        const dispatchCtx = { nativeEvent, ...getDispatchContext() };
        if (prevId) {
          void manager.dispatchPlatformEvent(prevId, "pointerout", dispatchCtx);
        }
        if (nextId) {
          void manager.dispatchPlatformEvent(nextId, "pointerover", dispatchCtx);
        }
      };
      const onPointerLeave = (nativeEvent) => {
        const prevId = hoverThreeJsonId;
        hoverThreeJsonId = "";
        if (prevId) {
          void manager.dispatchPlatformEvent(prevId, "pointerout", {
            nativeEvent,
            ...getDispatchContext()
          });
        }
      };
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);
      return () => {
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerleave", onPointerLeave);
        hoverThreeJsonId = "";
      };
    }
  };
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @returns {string|null}
 */
export function defaultResolveThreeJsonIdFromObject(object) {
  return resolveThreeJsonIdFromPick(object, null);
}

/**
 * @param {Event} event
 * @param {HTMLElement} canvas
 * @param {import("three").Camera} camera
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object} [options]
 * @param {string|null|undefined} [options.eventName]
 * @param {(object: import("three").Object3D|null, eventName?: string|null) => string|null|undefined} [options.resolveFromObject]
 * @returns {import("three").Object3D|null}
 */
export function pickObjectFromNativeEvent(event, canvas, camera, scene, options = {}) {
  const rect = canvas.getBoundingClientRect();
  const nx = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
  const ny = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
  const vector = new THREE.Vector3(nx * 2 - 1, -(ny * 2) + 1, 0.5);
  vector.unproject(camera);
  const raycaster = new THREE.Raycaster(camera.position, vector.sub(camera.position).normalize());
  raycaster.camera = camera;
  const intersects = raycaster.intersectObjects(scene.children, true);
  const eventName = options.eventName;
  const resolveFromObject =
    typeof options.resolveFromObject === "function" ? options.resolveFromObject : resolveThreeJsonIdFromPick;
  if (typeof eventName === "string" && eventName.trim()) {
    return pickObjectFromIntersectsForEvent(intersects, eventName, resolveFromObject);
  }
  return intersects.length > 0 ? intersects[0].object : null;
}

/**
 * Mark pickThroughRaycast on deployed objects whose objJson.name matches (self-skip pierce).
 * @param {import("three").Object3D|null|undefined} root
 * @param {string} name
 * @returns {number}
 */
export function applyPickThroughRaycastByObjectName(root, name) {
  const want = typeof name === "string" ? name.trim() : "";
  if (!root || !want || typeof root.traverse !== "function") {
    return 0;
  }
  let count = 0;
  root.traverse((node) => {
    const record = node.userData?.objJson;
    if (record && typeof record === "object" && record.name === want) {
      record.pickThroughRaycast = true;
      count += 1;
    }
  });
  return count;
}

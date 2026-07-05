/**
 * Host-page fallback for cabinet / UPS door dblclick (pickThrough + ELM gap).
 * Use capture-phase document listener before ELM; call stopImmediatePropagation when handled.
 */

import * as THREE from "three";
import { isDoorInteractable, openOrCloseDoor } from "../../domains/door/doorKinematics.js";

/**
 * @param {import("three").Object3D|null|undefined} node
 * @returns {import("three").Object3D|null}
 */
export function findUpsRoot(node) {
  let current = node ?? null;
  while (current) {
    const objJson = current.userData?.objJson;
    if (objJson?.domain === "device.ups" || objJson?.objType === "deviceUps" || current.name === "device-ups") {
      return current;
    }
    current = current.parent ?? null;
  }
  return null;
}

/**
 * @param {import("three").Object3D|null|undefined} node
 * @returns {import("three").Object3D|null}
 */
export function findCabinetRoot(node) {
  let current = node ?? null;
  while (current) {
    const objJson = current.userData?.objJson;
    if (objJson?.domain === "device.cabinet" || current.name === "cabinet") {
      return current;
    }
    current = current.parent ?? null;
  }
  return null;
}

/**
 * @param {import("three").Object3D|null|undefined} object
 * @param {import("three").Object3D|null|undefined} ancestor
 * @returns {boolean}
 */
export function isDescendantOfObject(object, ancestor) {
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
 * @param {(obj: import("three").Object3D) => boolean} [isPickBlocker]
 * @returns {import("three").Object3D|null}
 */
export function pickHostedContainerDoorTarget(intersects, isPickBlocker = () => false) {
  if (!Array.isArray(intersects) || intersects.length === 0) {
    return null;
  }
  /** @type {import("three").Intersection[]} */
  const visibleHits = [];
  for (let i = 0; i < intersects.length; i++) {
    const obj = intersects[i]?.object ?? null;
    if (!obj?.visible) {
      continue;
    }
    if (isPickBlocker(obj)) {
      continue;
    }
    visibleHits.push(intersects[i]);
  }
  if (!visibleHits.length) {
    return null;
  }
  for (let i = 0; i < visibleHits.length; i++) {
    const obj = visibleHits[i].object;
    const container = findUpsRoot(obj) || findCabinetRoot(obj);
    if (!container || container.userData?.objJson?.pickThroughRaycast !== true) {
      continue;
    }
    for (let j = 0; j < visibleHits.length; j++) {
      const hitObj = visibleHits[j].object;
      if (!isDescendantOfObject(hitObj, container)) {
        continue;
      }
      let node = hitObj;
      while (node) {
        if (isDoorInteractable(node)) {
          return node;
        }
        if (node === container) {
          break;
        }
        node = node.parent ?? null;
      }
    }
  }
  return visibleHits[0].object ?? null;
}

/**
 * @param {MouseEvent} event
 * @param {object} ctx
 * @param {() => import("three").Scene|import("three").Object3D|null|undefined} ctx.getScene
 * @param {() => import("three").Camera|null|undefined} ctx.getCamera
 * @param {() => HTMLElement|null|undefined} ctx.getCanvas
 * @param {(obj: import("three").Object3D) => boolean} [ctx.isPickBlocker]
 * @returns {import("three").Object3D|null}
 */
export function pickHostedContainerDoorAtClient(event, ctx) {
  const scene = ctx.getScene?.() ?? null;
  const camera = ctx.getCamera?.() ?? null;
  const canvas = ctx.getCanvas?.() ?? null;
  if (!scene || !camera || !canvas || !event) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const nx = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
  const ny = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
  const vector = new THREE.Vector3(nx * 2 - 1, -(ny * 2) + 1, 0.5);
  vector.unproject(camera);
  const raycaster = new THREE.Raycaster(
    camera.position,
    vector.sub(camera.position).normalize()
  );
  raycaster.camera = camera;
  const isPickBlocker = typeof ctx.isPickBlocker === "function" ? ctx.isPickBlocker : () => false;
  return pickHostedContainerDoorTarget(raycaster.intersectObjects(scene.children, true), isPickBlocker);
}

/**
 * @param {import("three").Object3D|null|undefined} node
 * @param {object} [options]
 * @param {() => void} [options.onDoorToggled]
 * @returns {boolean}
 */
export function tryToggleCabinetDoorFromNode(node, options = {}) {
  if (!node) {
    return false;
  }
  const cabinetRoot = findCabinetRoot(node);
  if (!cabinetRoot) {
    return false;
  }
  let current = node;
  while (current) {
    if (isDoorInteractable(current)) {
      openOrCloseDoor(current);
      options.onDoorToggled?.();
      return true;
    }
    if (current === cabinetRoot) {
      break;
    }
    current = current.parent ?? null;
  }
  let frontDoor = null;
  cabinetRoot.traverse((child) => {
    if (frontDoor || !isDoorInteractable(child)) {
      return;
    }
    frontDoor = child;
  });
  if (frontDoor) {
    openOrCloseDoor(frontDoor);
    options.onDoorToggled?.();
    return true;
  }
  return false;
}

/**
 * @param {import("three").Object3D|null|undefined} node
 * @param {object} [options]
 * @param {() => void} [options.onDoorToggled]
 * @returns {boolean}
 */
export function tryToggleUpsDoorFromNode(node, options = {}) {
  if (!node) {
    return false;
  }
  const upsRoot = findUpsRoot(node);
  if (!upsRoot) {
    return false;
  }
  let current = node;
  while (current) {
    if (isDoorInteractable(current)) {
      openOrCloseDoor(current);
      options.onDoorToggled?.();
      return true;
    }
    if (current === upsRoot) {
      break;
    }
    current = current.parent ?? null;
  }
  return false;
}

/**
 * @param {object} options
 * @param {() => import("three").Scene|import("three").Object3D|null|undefined} options.getScene
 * @param {() => import("three").Camera|null|undefined} options.getCamera
 * @param {() => HTMLElement|null|undefined} options.getCanvas
 * @param {(obj: import("three").Object3D) => boolean} [options.isPickBlocker]
 * @param {() => void} [options.onDoorToggled]
 * @returns {(event: MouseEvent) => void}
 */
export function createHostedContainerDoorDblclickHandler(options = {}) {
  const getScene = options.getScene ?? (() => null);
  const getCamera = options.getCamera ?? (() => null);
  const getCanvas = options.getCanvas ?? (() => null);
  const isPickBlocker = typeof options.isPickBlocker === "function" ? options.isPickBlocker : () => false;
  const onDoorToggled = typeof options.onDoorToggled === "function" ? options.onDoorToggled : null;

  return function handleHostedContainerDoorDblclick(event) {
    const scene = getScene();
    const camera = getCamera();
    const canvas = getCanvas();
    if (!scene || !camera || !canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const { clientX, clientY } = event;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return;
    }
    const picked = pickHostedContainerDoorAtClient(event, {
      getScene,
      getCamera,
      getCanvas,
      isPickBlocker
    });
    if (!picked) {
      return;
    }
    let handled = false;
    if (findCabinetRoot(picked)) {
      handled = tryToggleCabinetDoorFromNode(picked, { onDoorToggled: onDoorToggled ?? undefined });
    } else if (findUpsRoot(picked)) {
      handled = tryToggleUpsDoorFromNode(picked, { onDoorToggled: onDoorToggled ?? undefined });
    }
    if (handled) {
      event.stopImmediatePropagation();
    }
  };
}

/**
 * @param {object} [options] Same as createHostedContainerDoorDblclickHandler; optional `handler` override.
 * @returns {() => void} detach
 */
export function attachHostedContainerDoorDblclick(options = {}) {
  const handler =
    typeof options.handler === "function"
      ? options.handler
      : createHostedContainerDoorDblclickHandler(options);
  document.addEventListener("dblclick", handler, true);
  return () => {
    document.removeEventListener("dblclick", handler, true);
  };
}

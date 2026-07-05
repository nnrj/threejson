import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import {
  blendLook,
  clampLookDelta,
  clampPitch,
  isSmoothLookEnabled,
  resolveFirstPersonLookLimits,
  resolveLookSensitivity,
  resolveLookSmoothTime,
  resolveLookSmoothing,
  resolveMaxLookDelta
} from "./firstPersonLookUtils.js";

const DEFAULT_KEYS = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD"
};

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function normalizeKeyCode(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

function applyPolarLimits(pointerLock, limits) {
  if (hasOwn(pointerLock, "minPolarAngle")) {
    pointerLock.minPolarAngle = limits.minPolarAngle;
  }
  if (hasOwn(pointerLock, "maxPolarAngle")) {
    pointerLock.maxPolarAngle = limits.maxPolarAngle;
  }
}

/**
 * @param {import("three").PerspectiveCamera} camera
 * @param {HTMLElement} domElement
 * @param {object} config
 * @param {{ scene?: import("three").Scene, movementRoot?: import("three").Object3D }} [ctx]
 */
export function createFirstPersonControls(camera, domElement, config = {}, ctx = {}) {
  const scene = ctx.scene ?? null;
  let movementRoot = ctx.movementRoot ?? camera;
  const moveSpeed = Number.isFinite(config.moveSpeed) ? config.moveSpeed : 4;
  let eyeHeight = Number.isFinite(config.eyeHeight) ? config.eyeHeight : 1.6;
  let lookSensitivity = resolveLookSensitivity(config);
  const lookSmoothing = resolveLookSmoothing(config);
  const smoothLookEnabled = isSmoothLookEnabled(config);
  const lookSmoothTime = resolveLookSmoothTime(config);
  const maxLookDelta = resolveMaxLookDelta(config);
  const lookLimits = resolveFirstPersonLookLimits(config);
  const pointerLockEnabled = config.pointerLock !== false;
  const floorSnap = config.floorSnap !== false;
  const keys = {
    forward: normalizeKeyCode(config.keys?.forward, DEFAULT_KEYS.forward),
    back: normalizeKeyCode(config.keys?.back, DEFAULT_KEYS.back),
    left: normalizeKeyCode(config.keys?.left, DEFAULT_KEYS.left),
    right: normalizeKeyCode(config.keys?.right, DEFAULT_KEYS.right)
  };

  const pointerLock = new PointerLockControls(camera, domElement);
  if (smoothLookEnabled) {
    if (hasOwn(pointerLock, "pointerSpeed")) {
      pointerLock.pointerSpeed = 0;
    }
  } else if (hasOwn(pointerLock, "pointerSpeed")) {
    pointerLock.pointerSpeed = lookSensitivity * 500;
  }
  applyPolarLimits(pointerLock, lookLimits);

  const lookEuler = new THREE.Euler(0, 0, 0, "YXZ");
  let yaw = 0;
  let pitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;

  function syncLookFromCamera() {
    lookEuler.setFromQuaternion(camera.quaternion, "YXZ");
    yaw = lookEuler.y;
    pitch = lookEuler.x;
    targetYaw = yaw;
    targetPitch = pitch;
  }

  function applyLookRotation() {
    lookEuler.set(pitch, yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(lookEuler);
  }

  function applySmoothedLook(delta) {
    const blend = blendLook(delta, lookSmoothTime);
    yaw += (targetYaw - yaw) * blend;
    pitch += (targetPitch - pitch) * blend;
    pitch = clampPitch(pitch, lookLimits.pitchLimit);
    applyLookRotation();
  }

  function onSmoothMouseMove(event) {
    if (!enabled || !smoothLookEnabled || !pointerLock.isLocked) {
      return;
    }
    const { movementX, movementY } = clampLookDelta(event.movementX, event.movementY, maxLookDelta);
    targetYaw -= movementX * lookSensitivity;
    targetPitch -= movementY * lookSensitivity;
    targetPitch = clampPitch(targetPitch, lookLimits.pitchLimit);
  }

  function onPointerLock() {
    if (smoothLookEnabled) {
      syncLookFromCamera();
    }
  }

  const keyState = new Set();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const moveDelta = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  let enabled = config.enabled !== false;
  let lastFrameMs = 0;
  let collisionProvider = null;

  const useWindowKeys = typeof window !== "undefined";
  const keyTarget = useWindowKeys ? window : domElement;
  const mouseDoc = domElement?.ownerDocument ?? (typeof document !== "undefined" ? document : null);

  function onKeyDown(event) {
    if (!enabled) {
      return;
    }
    keyState.add(event.code);
  }

  function onKeyUp(event) {
    keyState.delete(event.code);
  }

  function onClick() {
    if (!enabled || !pointerLockEnabled) {
      return;
    }
    if (typeof domElement?.requestPointerLock === "function" && document.pointerLockElement !== domElement) {
      domElement.requestPointerLock();
    }
  }

  keyTarget.addEventListener("keydown", onKeyDown);
  keyTarget.addEventListener("keyup", onKeyUp);
  if (pointerLockEnabled && domElement) {
    domElement.addEventListener("click", onClick);
  }
  if (smoothLookEnabled && mouseDoc) {
    mouseDoc.addEventListener("mousemove", onSmoothMouseMove);
    pointerLock.addEventListener("lock", onPointerLock);
  }

  function applyFloorSnap() {
    if (!floorSnap || !scene) {
      return;
    }
    const origin = movementRoot.getWorldPosition(new THREE.Vector3());
    raycaster.set(origin.clone().add(new THREE.Vector3(0, 2, 0)), down);
    const hits = raycaster.intersectObjects(scene.children, true);
    if (hits.length <= 0) {
      return;
    }
    const floorY = hits[0].point.y;
    if (movementRoot === camera) {
      camera.position.y = floorY + eyeHeight;
    } else {
      const parent = movementRoot.parent;
      if (parent) {
        const worldPos = new THREE.Vector3(origin.x, floorY + eyeHeight, origin.z);
        movementRoot.position.copy(parent.worldToLocal(worldPos));
      } else {
        movementRoot.position.y = floorY + eyeHeight;
      }
    }
  }

  function applyCollision(delta) {
    if (!collisionProvider || typeof collisionProvider.resolve !== "function") {
      return;
    }
    collisionProvider.resolve({
      camera,
      movementRoot,
      deltaSeconds: delta,
      eyeHeight
    });
  }

  function updateMovement(delta) {
    if (!enabled || delta <= 0) {
      return;
    }

    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) {
      forward.set(0, 0, -1);
    } else {
      forward.normalize();
    }
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    moveDelta.set(0, 0, 0);
    if (keyState.has(keys.forward)) {
      moveDelta.add(forward);
    }
    if (keyState.has(keys.back)) {
      moveDelta.sub(forward);
    }
    if (keyState.has(keys.left)) {
      moveDelta.sub(right);
    }
    if (keyState.has(keys.right)) {
      moveDelta.add(right);
    }
    if (moveDelta.lengthSq() < 1e-10) {
      applyCollision(delta);
      if (floorSnap && !(collisionProvider && typeof collisionProvider.applyMovement === "function")) {
        applyFloorSnap();
      }
      return;
    }
    moveDelta.normalize().multiplyScalar(moveSpeed * delta);

    if (collisionProvider && typeof collisionProvider.applyMovement === "function") {
      collisionProvider.applyMovement({
        camera,
        movementRoot,
        moveDelta: moveDelta.clone(),
        deltaSeconds: delta,
        eyeHeight
      });
    } else if (movementRoot === camera) {
      camera.position.add(moveDelta);
    } else {
      movementRoot.position.add(moveDelta);
    }

    applyCollision(delta);
    if (floorSnap && !(collisionProvider && typeof collisionProvider.applyMovement === "function")) {
      applyFloorSnap();
    }
  }

  function applyLookConfig(nextConfig = {}) {
    lookSensitivity = resolveLookSensitivity({ ...config, ...nextConfig });
    const nextLimits = resolveFirstPersonLookLimits({ ...config, ...nextConfig });
    lookLimits.minPolarAngle = nextLimits.minPolarAngle;
    lookLimits.maxPolarAngle = nextLimits.maxPolarAngle;
    lookLimits.pitchLimit = nextLimits.pitchLimit;
    applyPolarLimits(pointerLock, lookLimits);
    if (!smoothLookEnabled && hasOwn(pointerLock, "pointerSpeed")) {
      pointerLock.pointerSpeed = lookSensitivity * 500;
    }
  }

  const adapter = {
    threeJsonControlsKind: "firstPerson",
    pointerLock,
    movementRoot,
    moveSpeed,
    eyeHeight,
    lookSensitivity,
    lookSmoothing,

    getObject() {
      return camera;
    },

    update() {
      if (!enabled) {
        return;
      }
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const delta = lastFrameMs > 0 ? Math.min((now - lastFrameMs) / 1000, 0.1) : 0;
      lastFrameMs = now;
      if (smoothLookEnabled) {
        applySmoothedLook(delta);
      }
      updateMovement(delta);
    },

    lock() {
      domElement?.requestPointerLock?.();
    },

    unlock() {
      document.exitPointerLock?.();
    },

    setMovementRoot(root) {
      if (root && root.isObject3D) {
        movementRoot = root;
        adapter.movementRoot = root;
      }
    },

    setCollisionProvider(provider) {
      collisionProvider = provider ?? null;
    },

    applyLookConfig,

    dispose() {
      keyTarget.removeEventListener("keydown", onKeyDown);
      keyTarget.removeEventListener("keyup", onKeyUp);
      if (domElement) {
        domElement.removeEventListener("click", onClick);
      }
      if (smoothLookEnabled && mouseDoc) {
        mouseDoc.removeEventListener("mousemove", onSmoothMouseMove);
        pointerLock.removeEventListener("lock", onPointerLock);
      }
      if (typeof pointerLock.disconnect === "function") {
        pointerLock.disconnect();
      }
      pointerLock.dispose?.();
    }
  };

  Object.defineProperty(adapter, "enabled", {
    get() {
      return enabled;
    },
    set(value) {
      enabled = value !== false;
    },
    enumerable: true
  });

  adapter.enabled = enabled;
  return adapter;
}

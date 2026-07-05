/**
 * Textured plane UV scroll (wind / plane + motion scrollUv); updated in the same frame loop as pointsMotion.scrollUv.
 */

/** @type {WeakMap<import("three").Mesh, { map: import("three").Texture, speedSigned: number, elapsed: number, axis: string }>} */
const planeScrollStateMap = new WeakMap();

/**
 * @param {number} elapsed
 * @param {number} speedSigned
 * @returns {number}
 */
export function computePlaneScrollOffset(elapsed, speedSigned) {
  const signed = Number.isFinite(speedSigned) && speedSigned !== 0 ? speedSigned : 1;
  const offset = (elapsed * Math.abs(signed) * 0.1) % 1;
  return signed < 0 ? 1 - offset : offset;
}

/** @type {Set<import("three").Mesh>} */
const planeScrollTargets = new Set();

/**
 * @param {object|null|undefined} planeObj
 * @returns {boolean}
 */
export function shouldPlaneScrollFromDescriptor(planeObj) {
  if (!planeObj) {
    return false;
  }
  const ot = typeof planeObj.objType === "string" ? planeObj.objType.trim().toLowerCase() : "";
  if (ot === "wind") {
    return true;
  }
  const motion = typeof planeObj.motion === "string" ? planeObj.motion.trim().toLowerCase() : "";
  return motion === "scrolluv" || motion === "scroll_uv" || motion === "scroll";
}

/**
 * @param {import("three").Mesh} plane
 * @param {object} planeObj
 */
export function setupPlaneScrollMotion(plane, planeObj) {
  if (!plane || !shouldPlaneScrollFromDescriptor(planeObj)) {
    return;
  }
  const material = plane.material;
  const map = material?.map;
  if (!map) {
    return;
  }
  const rawAxis = planeObj.scrollAxis ?? planeObj.motionAxis;
  const axis =
    typeof rawAxis === "string" && rawAxis.trim().toLowerCase() === "v" ? "v" : "u";
  const speedRaw = planeObj.speed ?? planeObj.motion?.speed;
  const speedSigned = Number(speedRaw);
  map.offset.x = map.offset.x ?? 0;
  map.offset.y = map.offset.y ?? 0;
  planeScrollStateMap.set(plane, {
    map,
    speedSigned: Number.isFinite(speedSigned) && speedSigned !== 0 ? speedSigned : 1,
    elapsed: 0,
    axis
  });
  planeScrollTargets.add(plane);
  if (!plane.userData._planeScrollRemovedBound) {
    plane.userData._planeScrollRemovedBound = true;
    plane.addEventListener("removed", () => {
      disposePlaneScrollMotion(plane);
    });
  }
}

/**
 * @param {number} deltaSeconds
 */
export function updatePlaneScrollMotion(deltaSeconds) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return;
  }
  for (const plane of planeScrollTargets) {
    if (!plane || !plane.parent) {
      disposePlaneScrollMotion(plane);
      continue;
    }
    const state = planeScrollStateMap.get(plane);
    if (!state?.map) {
      disposePlaneScrollMotion(plane);
      continue;
    }
    state.elapsed += deltaSeconds;
    const offset = computePlaneScrollOffset(state.elapsed, state.speedSigned);
    if (state.axis === "v") {
      state.map.offset.y = offset;
    } else {
      state.map.offset.x = offset;
    }
  }
}

/**
 * @param {import("three").Mesh} plane
 */
export function disposePlaneScrollMotion(plane) {
  planeScrollStateMap.delete(plane);
  planeScrollTargets.delete(plane);
}

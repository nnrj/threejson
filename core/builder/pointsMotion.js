/**
 * THREE.Points phase 2: motion (drift / scrollUv / twinkle).
 *
 * Registered targets live inside `createPointsMotionStore()` instances, one per
 * RuntimeContext (see core/runtime/runtimeContext.js), so each canvas's render loop
 * only advances its own points' motion instead of every canvas's on every frame
 * (previously an O(N²) cost across N concurrently-mounted scenes, and a source of
 * stale updates after a scene was disposed). `setupPointsMotion` auto-resolves its
 * scope from the target object (walks up to the attached scene); `updatePointsMotion`
 * takes an explicit trailing `runtimeScope` (the scene, already available in the
 * per-canvas render loop). Omitting either preserves today's shared-global behavior.
 */
import { log } from "../util/logger.js";
import {
  normalizePointsMotion,
  normalizeMotionType,
  resolveDriftDirection,
  resolvePointsHalfExtents,
  computeDriftPositions,
  computeTwinkleOpacity
} from "../util/pointsMotionUtil.js";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

function valueOr(value, fallback) {
  return hasValue(value) ? value : fallback;
}

export {
  normalizePointsMotion,
  normalizeMotionType,
  resolveDriftDirection,
  resolvePointsHalfExtents,
  computeDriftPositions,
  computeTwinkleOpacity
} from "../util/pointsMotionUtil.js";

function snapshotBasePositions(points) {
  const attr = points.geometry?.getAttribute?.("position");
  if (!attr || !attr.array) {
    return null;
  }
  return new Float32Array(attr.array);
}

function buildPhases(count, motionList) {
  const phases = new Float32Array(count);
  let seed = 0;
  for (let m = 0; m < motionList.length; m++) {
    const mt = motionList[m]?.type;
    if (mt === "drift" || mt === "twinkle") {
      seed += 1;
    }
  }
  if (seed === 0) {
    return phases;
  }
  for (let i = 0; i < count; i++) {
    phases[i] = Math.random() * Math.PI * 2;
  }
  return phases;
}

function setupScrollUvState(points, motion, record) {
  const material = points.material;
  const map = material?.map;
  if (!map) {
    log.warn("[setupPointsMotion] scrollUv requires material.map:", record?.name || points.name);
    return null;
  }
  map.offset.x = 0;
  map.offset.y = valueOr(map.offset.y, 0);
  const speed = Number(valueOr(motion.speed, valueOr(record.speed, 1)));
  return {
    map,
    speed: Number.isFinite(speed) && speed > 0 ? speed : 1,
    elapsed: 0
  };
}

function applyScrollUvStep(state, deltaSeconds) {
  const scrollUv = state.scrollUv;
  if (!scrollUv?.map) {
    return;
  }
  scrollUv.elapsed += deltaSeconds;
  scrollUv.map.offset.x = (scrollUv.elapsed * scrollUv.speed * 0.1) % 1;
}

function applyDriftStep(state, deltaSeconds) {
  const drift = state.drift;
  if (!drift || !state.basePositions) {
    return;
  }
  drift.elapsed += deltaSeconds;
  const attr = state.points.geometry.getAttribute("position");
  if (!attr) {
    return;
  }
  computeDriftPositions(
    state.basePositions,
    state.phases,
    drift.direction,
    drift.speed,
    drift.elapsed,
    drift.wrap,
    drift.halfExtents,
    attr.array
  );
  attr.needsUpdate = true;
}

function applyTwinkleStep(state, deltaSeconds) {
  const twinkle = state.twinkle;
  if (!twinkle || !state.points.material) {
    return;
  }
  twinkle.elapsed += deltaSeconds;
  const mat = state.points.material;
  if (twinkle.mode === "size") {
    mat.size = computeTwinkleOpacity(
      twinkle.elapsed,
      twinkle.speed,
      twinkle.minSize,
      twinkle.maxSize,
      twinkle.phase
    );
  } else {
    mat.opacity = computeTwinkleOpacity(
      twinkle.elapsed,
      twinkle.speed,
      twinkle.minOpacity,
      twinkle.maxOpacity,
      twinkle.phase
    );
  }
  mat.needsUpdate = true;
}

export function createPointsMotionStore() {
  const pointsMotionStateMap = new WeakMap();
  const pointsMotionTargets = new Set();

  function disposePointsMotion(points) {
    const state = pointsMotionStateMap.get(points);
    if (!state) {
      return;
    }
    if (state.onRemoved) {
      points.removeEventListener("removed", state.onRemoved);
    }
    pointsMotionStateMap.delete(points);
    pointsMotionTargets.delete(points);
  }

  function setupPointsMotion(points, record) {
    if (!points || !record) {
      return;
    }
    disposePointsMotion(points);

    const motions = normalizePointsMotion(record.motion);
    if (motions.length === 0) {
      return;
    }

    const basePositions = snapshotBasePositions(points);
    if (!basePositions) {
      return;
    }

    const pointCount = basePositions.length / 3;
    const phases = buildPhases(pointCount, motions);
    const halfExtents = resolvePointsHalfExtents(record);
    const material = points.material;
    const baseOpacity = material && Number.isFinite(material.opacity) ? material.opacity : 1;
    const baseSize = material && Number.isFinite(material.size) ? material.size : 4;

    /** @type {object} */
    const state = {
      points,
      record,
      basePositions,
      phases,
      drift: null,
      twinkle: null,
      scrollUv: null,
      onRemoved: null
    };

    for (let i = 0; i < motions.length; i++) {
      const motion = motions[i];
      const rawType = typeof motion.type === "string" ? motion.type.trim().toLowerCase() : "";
      const type = normalizeMotionType(rawType);

      if (type === "drift") {
        state.drift = {
          direction: resolveDriftDirection({ ...motion, type: rawType }),
          speed: Number(valueOr(motion.speed, 1)),
          wrap: motion.wrap !== false,
          halfExtents,
          elapsed: 0
        };
      } else if (type === "twinkle") {
        const twinkleMode = typeof motion.mode === "string" && motion.mode.trim().toLowerCase() === "size"
          ? "size"
          : "opacity";
        state.twinkle = {
          mode: twinkleMode,
          speed: Number(valueOr(motion.speed, 2)),
          minOpacity: Number(valueOr(motion.minOpacity, 0.35)),
          maxOpacity: Number(valueOr(motion.maxOpacity, baseOpacity)),
          minSize: Number(valueOr(motion.minSize, baseSize * 0.5)),
          maxSize: Number(valueOr(motion.maxSize, baseSize)),
          phase: Number(valueOr(motion.phase, 0)),
          elapsed: 0
        };
        if (material) {
          material.transparent = true;
        }
      } else if (type === "scrollUv") {
        if (!state.scrollUv) {
          state.scrollUv = setupScrollUvState(points, motion, record);
        }
      }
    }

    state.onRemoved = () => {
      disposePointsMotion(points);
    };
    points.addEventListener("removed", state.onRemoved);

    pointsMotionStateMap.set(points, state);
    pointsMotionTargets.add(points);
  }

  function updatePointsMotion(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }
    for (const points of pointsMotionTargets) {
      if (!points || !points.parent) {
        disposePointsMotion(points);
        continue;
      }
      const state = pointsMotionStateMap.get(points);
      if (!state) {
        pointsMotionTargets.delete(points);
        continue;
      }
      if (state.drift) {
        applyDriftStep(state, deltaSeconds);
      }
      if (state.twinkle) {
        applyTwinkleStep(state, deltaSeconds);
      }
      if (state.scrollUv) {
        applyScrollUvStep(state, deltaSeconds);
      }
    }
  }

  function dispose() {
    for (const points of pointsMotionTargets) {
      disposePointsMotion(points);
    }
  }

  return { setupPointsMotion, disposePointsMotion, updatePointsMotion, dispose };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).pointsMotion;
}

/**
 * @param {import("three").Points} points
 * @param {*} [runtimeScope]
 */
export function disposePointsMotion(points, runtimeScope) {
  return resolveStore(runtimeScope ?? points).disposePointsMotion(points);
}

/**
 * @param {import("three").Points} points
 * @param {object} record
 * @param {*} [runtimeScope]
 */
export function setupPointsMotion(points, record, runtimeScope) {
  return resolveStore(runtimeScope ?? points).setupPointsMotion(points, record);
}

/**
 * @param {number} deltaSeconds
 * @param {*} [runtimeScope]
 */
export function updatePointsMotion(deltaSeconds, runtimeScope) {
  return resolveStore(runtimeScope).updatePointsMotion(deltaSeconds);
}

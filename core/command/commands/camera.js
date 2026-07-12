import * as THREE from "three";
import { getObjectByThreeJsonId } from "../../handler/objectRegistry.js";
import {
  buildAdaptiveContentBoundingBoxTHREE,
  fitPerspectiveCameraToContentBoundsTHREE
} from "../../util/util.js";
import { buildCommandResult } from "../types.js";

/**
 * @param {import("three").Scene} scene
 * @param {string} threeJsonId
 * @returns {import("three").Object3D | null}
 */
function findObjectInScene(scene, threeJsonId) {
  const fromRegistry = getObjectByThreeJsonId(threeJsonId, scene);
  if (fromRegistry) {
    return fromRegistry;
  }
  const targetId = String(threeJsonId || "").trim();
  if (!targetId || !scene) {
    return null;
  }
  let found = null;
  scene.traverse((obj) => {
    if (found) {
      return;
    }
    const id = String(obj?.userData?.objJson?.threeJsonId || "").trim();
    if (id && id === targetId) {
      found = obj;
    }
  });
  return found;
}

/**
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} args
 */
export function handleCameraFit(ctx, args = {}) {
  if (!ctx.camera) {
    return buildCommandResult("camera.fit", {
      ok: false,
      mode: "runtime",
      error: "camera.fit requires ctx.camera."
    });
  }
  if (!ctx.scene?.isScene) {
    return buildCommandResult("camera.fit", {
      ok: false,
      mode: "runtime",
      error: "camera.fit requires ctx.scene."
    });
  }

  const objectId = String(args.id ?? "").trim();
  const target =
    args.target === "id" || objectId
      ? "id"
      : args.target === "selection"
        ? "selection"
        : "scene";

  let bounds = null;
  if (target === "id") {
    if (!objectId) {
      return buildCommandResult("camera.fit", {
        ok: false,
        mode: "runtime",
        error: 'camera.fit target "id" requires args.id.'
      });
    }
    const obj = findObjectInScene(ctx.scene, objectId);
    if (!obj) {
      return buildCommandResult("camera.fit", {
        ok: false,
        mode: "runtime",
        error: `camera.fit: object not found for id "${objectId}".`
      });
    }
    bounds = new THREE.Box3().setFromObject(obj);
  } else if (target === "selection") {
    const selectionId = String(ctx.options?.selectionId ?? "").trim();
    if (!selectionId) {
      return buildCommandResult("camera.fit", {
        ok: false,
        mode: "runtime",
        error: 'camera.fit target "selection" requires ctx.options.selectionId.'
      });
    }
    const obj = findObjectInScene(ctx.scene, selectionId);
    if (!obj) {
      return buildCommandResult("camera.fit", {
        ok: false,
        mode: "runtime",
        error: `camera.fit: selection object not found for id "${selectionId}".`
      });
    }
    bounds = new THREE.Box3().setFromObject(obj);
  } else {
    bounds = buildAdaptiveContentBoundingBoxTHREE(ctx.scene, {
      ignoreHelper: args.ignoreHelper ?? null
    });
  }

  if (!bounds || bounds.isEmpty()) {
    return buildCommandResult("camera.fit", {
      ok: false,
      mode: "runtime",
      error: "camera.fit: unable to compute non-empty bounds."
    });
  }

  const aspectHints =
    args.aspectHints && typeof args.aspectHints === "object" ? args.aspectHints : {};
  const ok = fitPerspectiveCameraToContentBoundsTHREE(ctx.camera, ctx.controls, bounds, {
    aspectHints,
    viewDirection: args.viewDirection,
    mode: args.controlsMode
  });

  return buildCommandResult("camera.fit", {
    ok,
    mode: "runtime",
    data: {
      target,
      threeJsonId: objectId || ctx.options?.selectionId || null
    },
    error: ok ? null : "camera.fit failed (missing controls or empty bounds)."
  });
}

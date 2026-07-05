import * as THREE from "three";

import { computeMeshCenterRestYOnAabbFloor } from "../../core/util/spatialQuery.js";

/**
 * 极简重力演示插件：在 `beforePhysics` 中对指定 mesh 做一维竖直运动（可替换为 Rapier 等）。
 * @param {{
 *   mesh: import("three").Object3D,
 *   floorMesh?: import("three").Object3D|null,
 *   floorY?: number,
 *   gravity?: number
 * }} opts
 */
function createSimpleGravityPlugin(opts) {
  const mesh = opts?.mesh;
  const floorMesh = opts?.floorMesh ?? null;
  const floorY = Number.isFinite(opts?.floorY) ? opts.floorY : 4;
  const gravity = Number.isFinite(opts?.gravity) ? opts.gravity : -22;
  let vy = 0;

  const fallbackMinY = floorY + 4;
  let minY = fallbackMinY;

  function refreshMinY() {
    if (floorMesh && mesh) {
      minY = computeMeshCenterRestYOnAabbFloor(floorMesh, mesh, { fallbackCenterY: fallbackMinY });
    } else {
      minY = fallbackMinY;
    }
  }

  refreshMinY();

  return {
    name: "simple-gravity-demo",

    /** @param {{ deltaSeconds?: number, nowMs?: number }} ctx */
    beforePhysics(ctx) {
      if (!mesh) {
        return;
      }
      const dt = Number.isFinite(ctx.deltaSeconds) && ctx.deltaSeconds > 0 ? ctx.deltaSeconds : 1 / 60;
      vy += gravity * dt;
      mesh.position.y += vy * dt;
      if (mesh.position.y < minY) {
        mesh.position.y = minY;
        vy = Math.abs(vy) * 0.35;
      }
    }
  };
}

export { createSimpleGravityPlugin };

import * as THREE from "three";

import { box3ToCuboidHalfExtents, setBox3FromObject } from "../../core/util/spatialQuery.js";

/**
 * @param {import("three").Object3D} object
 * @returns {{ halfX: number, halfY: number, halfZ: number, center: import("three").Vector3 }}
 */
function cuboidFromObject(object) {
  const box = new THREE.Box3();
  const canExpand =
    object
    && typeof object.updateWorldMatrix === "function"
    && (object.geometry || object.isObject3D);
  if (canExpand) {
    setBox3FromObject(box, object);
    const { halfX, halfY, halfZ, center } = box3ToCuboidHalfExtents(box);
    return { halfX, halfY, halfZ, center };
  }
  const px = object?.position?.x ?? 0;
  const py = object?.position?.y ?? 0;
  const pz = object?.position?.z ?? 0;
  return {
    halfX: 0.55,
    halfY: 0.55,
    halfZ: 0.55,
    center: new THREE.Vector3(px, py, pz)
  };
}

/**
 * @param {import("three").Object3D} mesh
 * @param {{ x: number, y: number, z: number }} t
 */
function writeMeshTranslation(mesh, t) {
  if (mesh?.position && typeof mesh.position.set === "function") {
    mesh.position.set(t.x, t.y, t.z);
  } else if (mesh?.position && typeof mesh.position === "object") {
    mesh.position.x = t.x;
    mesh.position.y = t.y;
    mesh.position.z = t.z;
  }
}

/**
 * 多刚体 Rapier 场景插件：多个 static collider + 多个 dynamic 刚体写回 mesh。
 *
 * @param {{
 *   entries: Array<{ mesh: import("three").Object3D, rigidBody: "dynamic"|"fixed"|"static", sensor?: boolean }>,
 *   RAPIER: object,
 *   gravity?: { x?: number, y?: number, z?: number }
 * }} opts
 */
async function createRapierScenePlugin(opts) {
  const entries = Array.isArray(opts?.entries) ? opts.entries : [];
  const RAPIER = opts?.RAPIER;
  if (!RAPIER) {
    throw new Error("createRapierScenePlugin: RAPIER required");
  }
  if (typeof RAPIER.init === "function") {
    await RAPIER.init();
  }

  const g = opts?.gravity;
  const gravity = {
    x: Number.isFinite(g?.x) ? g.x : 0,
    y: Number.isFinite(g?.y) ? g.y : -12,
    z: Number.isFinite(g?.z) ? g.z : 0
  };

  const world = new RAPIER.World(gravity);
  /** @type {Array<{ mesh: import("three").Object3D, body: object }>} */
  const dynamicPairs = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const mesh = entry?.mesh;
    if (!mesh) {
      continue;
    }
    const rb = String(entry.rigidBody || "dynamic").toLowerCase();
    const cuboid = cuboidFromObject(mesh);
    const px = mesh.position?.x ?? cuboid.center.x;
    const py = mesh.position?.y ?? cuboid.center.y;
    const pz = mesh.position?.z ?? cuboid.center.z;

    if (rb === "fixed" || rb === "static") {
      const collider = RAPIER.ColliderDesc.cuboid(cuboid.halfX, cuboid.halfY, cuboid.halfZ).setTranslation(
        cuboid.center.x,
        cuboid.center.y,
        cuboid.center.z
      );
      if (entry.sensor) {
        collider.setSensor(true);
      }
      world.createCollider(collider);
      continue;
    }

    const body = world
      .createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(px, py, pz).lockRotations());
    const colliderDesc = RAPIER.ColliderDesc.cuboid(cuboid.halfX, cuboid.halfY, cuboid.halfZ);
    if (entry.sensor) {
      colliderDesc.setSensor(true);
    }
    world.createCollider(colliderDesc, body);
    writeMeshTranslation(mesh, { x: px, y: py, z: pz });
    dynamicPairs.push({ mesh, body });
  }

  return {
    name: "rapier-scene",

    beforePhysics() {
      world.step();
      for (let i = 0; i < dynamicPairs.length; i++) {
        const pair = dynamicPairs[i];
        const t = pair.body.translation();
        writeMeshTranslation(pair.mesh, t);
      }
    }
  };
}

/**
 * 单地板 + 单动态体（兼容旧 API）。
 */
async function createRapierBoxDropPlugin(opts) {
  const mesh = opts?.mesh;
  const floorMesh = opts?.floorMesh ?? null;
  const RAPIER = opts?.RAPIER;
  if (!mesh || !RAPIER) {
    throw new Error("createRapierBoxDropPlugin: mesh and RAPIER required");
  }

  /** @type {Array<{ mesh: import("three").Object3D, rigidBody: string, sensor?: boolean }>} */
  const entries = [{ mesh, rigidBody: "dynamic" }];
  if (floorMesh) {
    entries.unshift({ mesh: floorMesh, rigidBody: "fixed" });
  }

  const g = opts?.gravity;
  const gravity = {
    x: Number.isFinite(g?.x) ? g.x : 0,
    y: Number.isFinite(g?.y) ? g.y : -12,
    z: Number.isFinite(g?.z) ? g.z : 0
  };

  const plugin = await createRapierScenePlugin({ entries, RAPIER, gravity });
  return {
    ...plugin,
    name: "rapier-box-drop"
  };
}

export { createRapierBoxDropPlugin, createRapierScenePlugin, cuboidFromObject };

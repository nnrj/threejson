/**
 * objType:text mode=mesh — TextGeometry extruded text.
 */
import * as THREE from "three";
import { log } from "../../util/logger.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";

import { loadingManager } from "../../cache/loading.js";
import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";
import { registerObject } from "../../handler/objectRegistry.js";
import { setUserDataObjJson } from "../../handler/objectDescriptorAttach.js";
import {
  applyTextTransform,
  attachBillboardBehavior,
  numberBetween,
  resolveTextRecord
} from "./textStyleShared.js";

const fontLoader = new FontLoader(loadingManager);
trackDisposableResource(fontLoader);

function loadFont(url) {
  return new Promise((resolve, reject) => {
    fontLoader.load(
      url,
      (font) => resolve(font),
      undefined,
      (err) => reject(err)
    );
  });
}

/**
 * @param {THREE.Object3D} parent
 * @param {object} record
 * @returns {Promise<THREE.Mesh|null>}
 */
export async function createMeshText(parent, record) {
  if (!parent || !record) {
    return null;
  }
  const resolved = resolveTextRecord(record);
  const meshBlock = resolved.mesh;
  const fontJsonUrl =
    typeof meshBlock.fontJsonUrl === "string" ? meshBlock.fontJsonUrl.trim() : "";
  if (!fontJsonUrl) {
    log.warn("[createMeshText] mode=mesh requires mesh.fontJsonUrl, skipped:", record.name ?? record.threeJsonId);
    return null;
  }

  let font;
  try {
    font = await loadFont(fontJsonUrl);
  } catch (error) {
    log.warn("[createMeshText] FontLoader failed:", fontJsonUrl, error);
    return null;
  }

  const depth = numberBetween(meshBlock.depth, 0.1, 0.001, 32);
  const bevelEnabled = meshBlock.bevelEnabled === true;
  const geometry = new TextGeometry(resolved.content, {
    font,
    size: resolved.fontSize,
    depth,
    bevelEnabled,
    bevelThickness: numberBetween(meshBlock.bevelThickness, 0.02, 0, 4),
    bevelSize: numberBetween(meshBlock.bevelSize, 0.02, 0, 4)
  });
  trackDisposableResource(geometry);
  geometry.computeBoundingBox();

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(resolved.color),
    metalness: numberBetween(meshBlock.metalness, 0, 0, 1),
    roughness: numberBetween(meshBlock.roughness, 0.45, 0, 1),
    side: THREE.DoubleSide
  });
  trackDisposableResource(material);

  const mesh = new THREE.Mesh(geometry, material);
  trackDisposableResource(mesh);

  if (geometry.boundingBox) {
    const box = geometry.boundingBox;
    const width = box.max.x - box.min.x;
    const height = box.max.y - box.min.y;
    const offsetX = -(box.min.x + width * resolved.anchor.x);
    const offsetY = -(box.min.y + height * resolved.anchor.y);
    geometry.translate(offsetX, offsetY, 0);
  }

  const outRecord = { ...record, objType: "text", mode: "mesh" };
  mesh.name = resolved.name;
  setUserDataObjJson(mesh, outRecord);
  applyTextTransform(mesh, record);
  attachBillboardBehavior(mesh, resolved.billboard);

  parent.add(mesh);
  registerObject(mesh, outRecord);
  return mesh;
}

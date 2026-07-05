import { deployShaderSurface } from "../../../core/builder/shader/shaderSurfaceBuilder.js";
import { log } from "../../../core/util/logger.js";
import { finalizeDomainDeployRoot } from "../../../core/handler/domainDeployDescriptor.js";
import { buildWaterSurfaceRecord } from "./waterPresets.js";
import { parseWaterQuality } from "./waterQuality.js";
import { attachWaterMirror, disposeWaterMirror } from "./waterMirror.js";

const NATURE_WATER_DOMAIN_ID = "nature.water";

/**
 * @param {string} handler
 * @param {object} [overrides]
 * @returns {object|null}
 */
export function createWaterSurfaceJson(handler, overrides = {}) {
  return buildWaterSurfaceRecord(handler ?? "ocean", overrides);
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 * @param {object} [ctx]
 * @returns {import("three").Mesh|null}
 */
export function deployWaterSurface(record, scene, ctx = {}) {
  if (!record || !scene) {
    return null;
  }
  const handler = record.handler ?? "ocean";
  const planeRecord = buildWaterSurfaceRecord(handler, record);
  if (!planeRecord) {
    log.warn("[nature.water] deployWaterSurface failed, handler:", handler);
    return null;
  }
  const mesh = deployShaderSurface(planeRecord, scene, ctx);
  if (mesh) {
    mesh.receiveShadow = record.receiveShadow !== false;
    const { profile } = parseWaterQuality(planeRecord);
    if (profile.useMirror && mesh.material?.userData?.waterUseMirror) {
      const mirrorCtx = attachWaterMirror(mesh, {
        mirrorResolution: profile.mirrorResolution
      });
      if (mirrorCtx) {
        mesh.material.userData.waterMirrorDispose = () => {
          mirrorCtx.dispose();
          disposeWaterMirror(mesh);
        };
      }
    }
    const domainId = String(record.domain || "").trim();
    if (domainId || normalizeSceneObjType(record.objType) === "domain") {
      finalizeDomainDeployRoot(mesh, {
        domainId: domainId || NATURE_WATER_DOMAIN_ID,
        handler,
        loadRecord: record
      });
    }
  }
  return mesh;
}

function normalizeSceneObjType(objType) {
  return typeof objType === "string" ? objType.trim().toLowerCase() : "";
}

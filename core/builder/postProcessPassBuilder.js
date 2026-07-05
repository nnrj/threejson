/**
 * Post-process Pass factory and pass record JSON construction; registers per-passType sub-parsers.
 */
import * as THREE from "three";
import { log } from "../util/logger.js";
import {
  OUTLINE_HIDDEN_DEFAULT,
  OUTLINE_VISIBLE_DEFAULT
} from "../theme/runtimeVisualDefaults.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerPassTypeFactory } from "../handler/postProcessPassTypeRegistry.js";
import {
  hasPassTargetIds,
  resolvePassTargets
} from "../util/passTargetResolver.js";

/**
 * @param {*} value
 * @param {*} fallback
 */
function valueOr(value, fallback) {
  return value !== undefined && value !== null ? value : fallback;
}

/**
 * @param {object} record
 * @returns {boolean}
 */
function isRelaxedOutlineTarget(record) {
  if (record.allowEmptyTarget === true) {
    return true;
  }
  const policy = typeof record.targetPolicy === "string" ? record.targetPolicy.trim().toLowerCase() : "strict";
  return policy === "relaxed";
}

/**
 * @param {object} ctx
 * @returns {{ width: number, height: number }}
 */
function resolvePassResolution(ctx) {
  const renderer = ctx?.renderer;
  const dom = renderer?.domElement;
  const width = dom?.clientWidth || dom?.width || (typeof window !== "undefined" ? window.innerWidth : 1);
  const height = dom?.clientHeight || dom?.height || (typeof window !== "undefined" ? window.innerHeight : 1);
  return {
    width: Math.max(1, Number(width) || 1),
    height: Math.max(1, Number(height) || 1)
  };
}

/**
 * @param {import("three/examples/jsm/postprocessing/OutlinePass.js").OutlinePass} pass
 * @param {object} record
 */
export function applyOutlinePassParams(pass, record) {
  if (!pass || !record) {
    return;
  }
  if (record.renderToScreen !== undefined) {
    pass.renderToScreen = Boolean(record.renderToScreen);
  }
  if (record.edgeGlow !== undefined) {
    pass.edgeGlow = Number(record.edgeGlow);
  }
  if (record.usePatternTexture !== undefined) {
    pass.usePatternTexture = record.usePatternTexture;
  }
  if (record.edgeThickness !== undefined) {
    pass.edgeThickness = Number(record.edgeThickness);
  }
  if (record.edgeStrength !== undefined) {
    pass.edgeStrength = Number(record.edgeStrength);
  }
  if (record.pulsePeriod !== undefined) {
    pass.pulsePeriod = Number(record.pulsePeriod);
  }
  if (record.visibleEdgeColor != null) {
    pass.visibleEdgeColor.set(record.visibleEdgeColor);
  }
  if (record.hiddenEdgeColor != null) {
    pass.hiddenEdgeColor.set(record.hiddenEdgeColor);
  }
  if (record.enabled !== undefined) {
    pass.enabled = Boolean(record.enabled);
  }
}

/**
 * @param {object} record
 * @param {object} ctx
 * @returns {import("three/examples/jsm/postprocessing/OutlinePass.js").OutlinePass|null}
 */
export function createOutlinePassFromRecord(record, ctx) {
  const scene = ctx?.scene;
  const camera = ctx?.camera;
  if (!scene || !camera) {
    log.warn("[pass:outline] scene and camera are required");
    return null;
  }
  if (!hasPassTargetIds(record) && !isRelaxedOutlineTarget(record)) {
    log.warn("[pass:outline] strict targetPolicy: missing threeJsonId/threeJsonIds, skip");
    return null;
  }
  const { width, height } = resolvePassResolution(ctx);
  const pass = new OutlinePass(new THREE.Vector2(width, height), scene, camera);
  trackDisposableResource(pass);
  pass.selectedObjects = resolvePassTargets(record, {
    onMissing: (id) => {
      log.warn("[pass:outline] threeJsonId not found:", id);
    }
  });
  applyOutlinePassParams(pass, {
    renderToScreen: false,
    edgeGlow: 1,
    usePatternTexture: 1,
    edgeThickness: 2,
    edgeStrength: 5,
    pulsePeriod: 2,
    visibleEdgeColor: OUTLINE_VISIBLE_DEFAULT,
    hiddenEdgeColor: OUTLINE_HIDDEN_DEFAULT,
    enabled: true,
    ...record
  });
  if (!pass.selectedObjects.length) {
    pass.enabled = false;
  }
  return pass;
}

/**
 * @param {object} record
 * @param {object} ctx
 * @returns {import("three/examples/jsm/postprocessing/RenderPass.js").RenderPass|null}
 */
export function createRenderPassFromRecord(record, ctx) {
  const scene = ctx?.scene;
  const camera = ctx?.camera;
  if (!scene || !camera) {
    log.warn("[pass:render] scene and camera are required");
    return null;
  }
  if (hasPassTargetIds(record)) {
    log.warn("[pass:render] threeJsonId/threeJsonIds are ignored on render pass");
  }
  const pass = new RenderPass(scene, camera);
  trackDisposableResource(pass);
  if (record.enabled !== undefined) {
    pass.enabled = Boolean(record.enabled);
  }
  if (record.renderToScreen !== undefined) {
    pass.renderToScreen = Boolean(record.renderToScreen);
  }
  return pass;
}

/**
 * @param {object} record
 * @param {object} ctx
 * @returns {import("three/examples/jsm/postprocessing/OutputPass.js").OutputPass|null}
 */
export function createOutputPassFromRecord(record, ctx) {
  if (hasPassTargetIds(record)) {
    log.warn("[pass:output] threeJsonId/threeJsonIds are ignored on output pass");
  }
  const pass = new OutputPass();
  trackDisposableResource(pass);
  if (record.enabled !== undefined) {
    pass.enabled = Boolean(record.enabled);
  }
  if (record.renderToScreen !== undefined) {
    pass.renderToScreen = Boolean(record.renderToScreen);
  } else {
    pass.renderToScreen = true;
  }
  return pass;
}

/**
 * @param {object} record
 * @param {object} _ctx
 * @returns {null}
 */
function createUnrealBloomPassStub(record, _ctx) {
  log.warn("[pass:unrealBloom] not implemented yet; record id:", record?.id);
  return null;
}

/**
 * @param {object} record
 * @param {object} _ctx
 * @returns {null}
 */
function createShaderPassStub(record, _ctx) {
  log.warn("[pass:shader] not implemented yet; record id:", record?.id);
  return null;
}

/**
 * @param {object} [overrides]
 * @returns {object}
 */
export function createPassRecordJson(overrides = {}) {
  const passType =
    typeof overrides.passType === "string" && overrides.passType.trim()
      ? overrides.passType.trim().toLowerCase()
      : "outline";
  return {
    objType: "pass",
    passType,
    targetPolicy: "strict",
    allowEmptyTarget: false,
    enabled: true,
    renderToScreen: false,
    ...overrides,
    objType: "pass",
    passType
  };
}

let factoriesRegistered = false;

/** Register built-in passType factories (idempotent) */
export function ensureDefaultPassTypeFactories() {
  if (factoriesRegistered) {
    return;
  }
  registerPassTypeFactory("outline", createOutlinePassFromRecord);
  registerPassTypeFactory("render", createRenderPassFromRecord);
  registerPassTypeFactory("output", createOutputPassFromRecord);
  registerPassTypeFactory("unrealbloom", createUnrealBloomPassStub);
  registerPassTypeFactory("shader", createShaderPassStub);
  factoriesRegistered = true;
}

ensureDefaultPassTypeFactories();

/**
 * objType pass: record normalization, deploy, and composer attachment.
 */
import { expandPassListEntry } from "./passListEntryRegistry.js";
import { log } from "../util/logger.js";
import { createPassByType, normalizePassType } from "./postProcessPassTypeRegistry.js";
import { ensureDefaultPassTypeFactories } from "../builder/postProcessPassBuilder.js";
import { createOutputPassFromRecord } from "../builder/postProcessPassBuilder.js";
import {
  clearPassRuntimeRegistry,
  registerDeployedPass
} from "../util/scenePassRuntime.js";
import { listOr } from "../util/util.js";

const OUTLINE_TARGET_KEYS = ["threeJsonId", "threeJsonIds", "targetPolicy", "allowEmptyTarget", "highlightChannel"];

/**
 * @param {object} sceneConfig
 * @returns {{ autoOutputPass: boolean }}
 */
export function resolvePostProcessingConfig(sceneConfig = {}) {
  const root =
    sceneConfig?.postProcessing && typeof sceneConfig.postProcessing === "object"
      ? sceneConfig.postProcessing
      : {};
  return {
    autoOutputPass: root.autoOutputPass !== false
  };
}

/**
 * @param {object} record
 * @returns {object}
 */
export function normalizePassRecord(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  let next = expandPassListEntry({ ...record });
  if (typeof next.highlightChannel === "string" && next.highlightChannel.trim()) {
    log.warn(
      "[pass] highlightChannel was not expanded; deploy with builtins/register (sceneHighlight domain)"
    );
  }
  delete next.highlightChannel;

  if (!next.objType) {
    next.objType = "pass";
  }
  if (!next.passType) {
    next.passType = "outline";
  }
  next.passType = normalizePassType(next.passType) || "outline";

  const passType = next.passType;
  if (passType !== "outline") {
    for (let i = 0; i < OUTLINE_TARGET_KEYS.length; i++) {
      const key = OUTLINE_TARGET_KEYS[i];
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        log.warn(`[pass] field "${key}" is ignored for passType=${passType}`);
        delete next[key];
      }
    }
  }
  return next;
}

/**
 * @param {object[]} objectList
 * @returns {object[]}
 */
export function filterPassRecords(objectList) {
  const list = listOr(objectList);
  const passes = [];
  for (let i = 0; i < list.length; i++) {
    const record = list[i];
    if (!record || typeof record !== "object") {
      continue;
    }
    const objType = typeof record.objType === "string" ? record.objType.trim().toLowerCase() : "";
    if (objType === "pass") {
      passes.push(normalizePassRecord(record));
    }
  }
  return passes;
}

/**
 * @param {object[]} objectList
 * @returns {object[]}
 */
export function filterNonPassRecords(objectList) {
  const list = listOr(objectList);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const record = list[i];
    if (!record || typeof record !== "object") {
      continue;
    }
    const objType = typeof record.objType === "string" ? record.objType.trim().toLowerCase() : "";
    if (objType !== "pass" && objType !== "boxhelper") {
      out.push(record);
    }
  }
  return out;
}

/**
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function comparePassOrder(a, b) {
  const oa = Number.isFinite(Number(a?.order)) ? Number(a.order) : 0;
  const ob = Number.isFinite(Number(b?.order)) ? Number(b.order) : 0;
  return oa - ob;
}

/**
 * @param {object} record
 * @param {object} ctx
 * @param {{ renderPassCount?: { value: number } }} [state]
 * @returns {import("three/examples/jsm/postprocessing/Pass.js").Pass|null}
 */
export function deployPassRecord(record, ctx, state = {}) {
  ensureDefaultPassTypeFactories();
  const normalized = normalizePassRecord(record);
  const passType = normalized.passType;

  if (passType === "render") {
    const counter = state.renderPassCount ?? { value: 0 };
    if (counter.value > 0 && normalized.allowMultiple !== true) {
      log.warn("[pass:render] duplicate render pass skipped; set allowMultiple:true to allow");
      return null;
    }
    counter.value += 1;
    state.renderPassCount = counter;
  }

  const pass = createPassByType(normalized, ctx);
  if (!pass) {
    return null;
  }

  const passId =
    typeof normalized.id === "string" && normalized.id.trim()
      ? normalized.id.trim()
      : `pass-${passType}-${state.deployIndex ?? 0}`;

  const composer = ctx?.composer;
  if (composer && typeof composer.addPass === "function") {
    composer.addPass(pass);
  } else if (composer === null || composer === undefined) {
    log.warn("[pass] no EffectComposer on ctx; pass created but not added:", passId);
  }

  registerDeployedPass(passId, pass, normalized, passType);
  return pass;
}

/**
 * @param {object} normalizedPayload Includes objectList, sceneConfig
 * @param {object} ctx  scene, camera, renderer, composer
 * @returns {import("three/examples/jsm/postprocessing/Pass.js").Pass[]}
 */
export function deployPassRecordsFromObjectList(normalizedPayload, ctx) {
  clearPassRuntimeRegistry();
  const records = filterPassRecords(normalizedPayload?.objectList);
  records.sort(comparePassOrder);

  const state = { renderPassCount: { value: 0 }, deployIndex: 0 };
  const deployed = [];
  let hasOutputPass = false;

  for (let i = 0; i < records.length; i++) {
    state.deployIndex = i;
    const record = records[i];
    if (normalizePassType(record.passType) === "output") {
      hasOutputPass = true;
    }
    const pass = deployPassRecord(record, ctx, state);
    if (pass) {
      deployed.push(pass);
    }
  }

  const ppConfig = resolvePostProcessingConfig(normalizedPayload?.sceneConfig);
  if (ppConfig.autoOutputPass && !hasOutputPass && deployed.length > 0 && ctx?.composer) {
    const outputPass = createOutputPassFromRecord({ passType: "output", id: "__auto_output__" }, ctx);
    if (outputPass) {
      ctx.composer.addPass(outputPass);
      registerDeployedPass("__auto_output__", outputPass, { passType: "output" }, "output");
      deployed.push(outputPass);
    }
  }

  return deployed;
}

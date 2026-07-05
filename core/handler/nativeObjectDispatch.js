/**
 * Native deploy + final enableDefaultModel fallback.
 */
import { deployNativeObjectRecord } from "../builder/nativeObjectBuilder.js";
import { log } from "../util/logger.js";
import { isDefaultModelEnabled } from "./defaultModelDescriptor.js";
import { deployAsDefaultModel } from "./sceneDefaultModel.js";

/**
 * @param {import("three").Object3D|import("three").Scene} targetRoot
 * @param {object} record
 * @param {object} [ctx]
 */
export function deployNativeObjectRecordWithFallback(targetRoot, record, ctx = {}) {
  if (deployNativeObjectRecord(targetRoot, record, ctx)) {
    return;
  }
  if (isDefaultModelEnabled(ctx)) {
    deployAsDefaultModel(targetRoot, record, ctx);
    return;
  }
  log.warn(
    "[nativeObjectBuilder] skipped; enable sceneConfig.enableDefaultModel or use a supported objType:",
    record?.objType ?? "",
    record?.name || ""
  );
}

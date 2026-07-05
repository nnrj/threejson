/**
 * Unified business-domain dispatch from worldInfo.domainModelList (each domain implements resolveDomainModel or domainHandlers on its descriptor).
 */
import { log } from "../util/logger.js";
import {
  getDomain,
  initBusinessDomains,
  isDomainDispatchable
} from "./businessDomainRegistry.js";
import { listOr } from "../util/util.js";

/**
 * @param {import("three").Scene} scene
 * @param {object} [worldInfo]
 * @param {object} [ctx]
 */
export function applyDomainModelsFromWorldInfo(scene, worldInfo, ctx) {
  const models = listOr(worldInfo?.domainModelList);
  applyDomainModelList(scene, models, ctx);
}

/**
 * @param {import("three").Scene} scene
 * @param {object[]} domainModelList
 * @param {object} [ctx]
 */
export function applyDomainModelList(scene, domainModelList, ctx) {
  initBusinessDomains();
  if (!scene) {
    return;
  }
  const list = listOr(domainModelList);
  for (let i = 0; i < list.length; i++) {
    const record = list[i];
    if (!record || typeof record !== "object") {
      continue;
    }
    const domainId = record.domain;
    if (!domainId) {
      log.warn("[applyDomainModelList] missing domain at index", i, record);
      continue;
    }
    const domain = getDomain(domainId);
    if (!domain) {
      log.warn("[applyDomainModelList] unknown domain:", domainId);
      continue;
    }
    if (!isDomainDispatchable(domain)) {
      log.warn(
        "[applyDomainModelList] domain is not dispatchable (namespace-only or missing deploy api):",
        domainId,
        "— use a leaf qualified id such as",
        domainId.includes(".") ? `${domainId}.<child>` : `${domainId}.<subDomain>`
      );
      continue;
    }
    if (typeof domain.resolveDomainModel === "function") {
      domain.resolveDomainModel(record, scene, ctx);
      continue;
    }
    const handlerName = record.handler ?? domain.defaultHandler;
    if (!handlerName) {
      log.warn("[applyDomainModelList] no handler and domain has no defaultHandler:", domainId);
      continue;
    }
    const fn = domain.domainHandlers?.[handlerName];
    if (typeof fn === "function") {
      fn(record, scene, ctx);
      continue;
    }
    log.warn(
      "[applyDomainModelList] unsupported handler (add resolveDomainModel or domainHandlers):",
      domainId,
      handlerName
    );
  }
}

/**
 * Dispatch a single `domainModel` record (equivalent to `applyDomainModelList(scene, [record], ctx)`).
 * @param {import("three").Scene} scene
 * @param {{ domain: string, handler?: string, items?: unknown, payload?: unknown, options?: object }} record
 * @param {object} [ctx]
 */
export function invokeDomainModel(scene, record, ctx) {
  if (!record || typeof record !== "object") {
    log.warn("[invokeDomainModel] missing record");
    return;
  }
  if (!record.domain) {
    log.warn("[invokeDomainModel] record.domain is required");
    return;
  }
  applyDomainModelList(scene, [record], ctx);
}

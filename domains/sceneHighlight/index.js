import { registerPassListEntryExpander } from "../../core/handler/passListEntryRegistry.js";
import { log } from "../../core/util/logger.js";
import { deployPassRecord, normalizePassRecord } from "../../core/handler/postProcessPassDeploy.js";
import { createSceneHighlightBundle } from "./bundle.js";
import { createPageHighlightSetup } from "./pageSetup.js";
import {
  createSceneHighlightPassJson,
  expandPassListEntry,
  HIGHLIGHT_CHANNEL_STYLES,
  normalizeHighlightChannel
} from "./channels.js";

registerPassListEntryExpander(expandPassListEntry);

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 * @param {object} ctx
 */
function resolveSceneHighlightDomainModel(record, scene, ctx) {
  const handler = typeof record.handler === "string" ? record.handler.trim().toLowerCase() : "";
  if (handler === "deploybundle" || handler === "deploy_bundle") {
    const composer = ctx?.composer;
    if (!composer) {
      log.warn("[sceneHighlight] deployBundle requires ctx.composer");
      return;
    }
    createSceneHighlightBundle(scene, ctx?.camera, {
      composer,
      renderer: ctx?.renderer ?? null,
      ...(record.options && typeof record.options === "object" ? record.options : {})
    });
    return;
  }
  const channel = normalizeHighlightChannel(handler || record.highlightChannel);
  if (channel) {
    const passRecord = createSceneHighlightPassJson({
      highlightChannel: channel,
      ...(record.options && typeof record.options === "object" ? record.options : record)
    });
    deployPassRecord(passRecord, {
      scene: ctx?.scene ?? scene,
      camera: ctx?.camera,
      renderer: ctx?.renderer,
      composer: ctx?.composer
    });
    return;
  }
  if (handler) {
    log.warn("[sceneHighlight] unsupported handler:", handler);
  }
}

function createSceneHighlightJson(overrides = {}) {
  return {
    objType: "domain",
    domain: "sceneHighlight",
    handler: overrides.handler ?? "deployBundle",
    ...overrides
  };
}

/** create/deploy facade satisfying registry contract */
function createSceneHighlight(descriptor, scene, ctx) {
  const record = createSceneHighlightJson(
    descriptor && typeof descriptor === "object" ? descriptor : {}
  );
  resolveSceneHighlightDomainModel(record, scene, ctx);
  return null;
}

function deploySceneHighlight(record, scene, ctx) {
  resolveSceneHighlightDomainModel(record, scene, ctx);
}

const sceneHighlightDomain = {
  id: "sceneHighlight",
  defaultHandler: "deployBundle",
  resolveDomainModel: resolveSceneHighlightDomainModel,
  domainHandlers: {
    locate: (record, scene, ctx) =>
      resolveSceneHighlightDomainModel({ ...record, handler: "locate" }, scene, ctx),
    info: (record, scene, ctx) =>
      resolveSceneHighlightDomainModel({ ...record, handler: "info" }, scene, ctx),
    alarm: (record, scene, ctx) =>
      resolveSceneHighlightDomainModel({ ...record, handler: "alarm" }, scene, ctx),
    deployBundle: (record, scene, ctx) =>
      resolveSceneHighlightDomainModel({ ...record, handler: "deployBundle" }, scene, ctx)
  },
  api: {
    createSceneHighlightJson,
    createSceneHighlightPassJson,
    createSceneHighlightBundle,
    createPageHighlightSetup,
    createSceneHighlight,
    deploySceneHighlight,
    expandPassListEntry,
    normalizePassRecord,
    HIGHLIGHT_CHANNEL_STYLES,
    normalizeHighlightChannel
  }
};

export default sceneHighlightDomain;

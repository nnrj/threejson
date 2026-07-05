/**
 * Three-channel OutlinePass bundle (locate + info + alarm).
 */
import { createPassRecordJson } from "../../core/builder/postProcessPassBuilder.js";
import { deployPassRecord } from "../../core/handler/postProcessPassDeploy.js";
import { getDeployedPass } from "../../core/util/scenePassRuntime.js";
import { HIGHLIGHT_CHANNEL_STYLES, createSceneHighlightPassJson } from "./channels.js";

/**
 * @param {import("three").Scene} scene
 * @param {import("three").Camera} camera
 * @param {{
 *   composer: import("three/examples/jsm/postprocessing/EffectComposer.js").EffectComposer,
 *   renderer?: import("three").WebGLRenderer,
 *   includeRenderPass?: boolean,
 *   renderPassOrder?: number,
 *   channels?: Partial<Record<"locate"|"info"|"alarm", object>>,
 *   channelOrders?: { locate?: number, info?: number, alarm?: number }
 * }} options
 */
export function createSceneHighlightBundle(scene, camera, options = {}) {
  const composer = options.composer;
  if (!composer) {
    throw new Error("[sceneHighlight] createSceneHighlightBundle requires options.composer");
  }
  const ctx = {
    scene,
    camera,
    composer,
    renderer: options.renderer ?? null
  };

  const deployed = {
    renderPass: null,
    locatePass: null,
    infoPass: null,
    alarmPass: null
  };
  const passIds = {
    render: "pass-render",
    locate: "pass-locate",
    info: "pass-info",
    alarm: "pass-alarm"
  };

  if (options.includeRenderPass !== false) {
    const renderRecord = createPassRecordJson({
      passType: "render",
      id: passIds.render,
      order: options.renderPassOrder ?? 0,
      allowMultiple: false
    });
    deployed.renderPass = deployPassRecord(renderRecord, ctx);
  }

  const channelOrders = options.channelOrders ?? { locate: 10, info: 20, alarm: 30 };
  const channels = options.channels ?? {};

  const locateRecord = createSceneHighlightPassJson({
    highlightChannel: "locate",
    id: passIds.locate,
    order: channelOrders.locate,
    allowEmptyTarget: true,
    targetPolicy: "relaxed",
    ...channels.locate
  });
  const infoRecord = createSceneHighlightPassJson({
    highlightChannel: "info",
    id: passIds.info,
    order: channelOrders.info,
    allowEmptyTarget: true,
    targetPolicy: "relaxed",
    ...channels.info
  });
  const alarmRecord = createSceneHighlightPassJson({
    highlightChannel: "alarm",
    id: passIds.alarm,
    order: channelOrders.alarm,
    allowEmptyTarget: true,
    targetPolicy: "relaxed",
    ...channels.alarm
  });

  deployPassRecord(locateRecord, ctx);
  deployPassRecord(infoRecord, ctx);
  deployPassRecord(alarmRecord, ctx);

  deployed.locatePass = getDeployedPass(passIds.locate)?.pass ?? null;
  deployed.infoPass = getDeployedPass(passIds.info)?.pass ?? null;
  deployed.alarmPass = getDeployedPass(passIds.alarm)?.pass ?? null;

  return {
    composer,
    passIds,
    channelStyles: HIGHLIGHT_CHANNEL_STYLES,
    ...deployed,
    getPass(channel) {
      const id = passIds[channel];
      return id ? getDeployedPass(id)?.pass ?? null : null;
    }
  };
}

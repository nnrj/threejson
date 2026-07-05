/**
 * Page-level post-process highlight init: domain bundle + interaction controller.
 */
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { trackDisposableResource } from "../../core/handler/resourceReclaimer.js";
import {
  createHighlightTargetResolver,
  createSceneHighlightInteractionController
} from "../../core/util/sceneHighlightInteraction.js";
import { createSceneHighlightBundle } from "./bundle.js";

/**
 * @param {import("three").Scene} scene
 * @param {import("three").Camera} camera
 * @param {{
 *   composer: import("three/examples/jsm/postprocessing/EffectComposer.js").EffectComposer,
 *   renderer?: import("three").WebGLRenderer,
 *   channelOptions?: Partial<Record<"locate"|"info"|"alarm", object>>,
 *   resolveOptions?: object,
 *   includeRenderPass?: boolean,
 *   includeOutputPass?: boolean,
 *   channelOrders?: { locate?: number, info?: number, alarm?: number }
 * }} options
 */
export function createPageHighlightSetup(scene, camera, options = {}) {
  const composer = options.composer;
  if (!composer) {
    throw new Error("[sceneHighlight] createPageHighlightSetup requires options.composer");
  }

  const raw = createSceneHighlightBundle(scene, camera, {
    composer,
    renderer: options.renderer ?? null,
    channels: options.channelOptions ?? options.channels ?? {},
    includeRenderPass: options.includeRenderPass,
    channelOrders: options.channelOrders
  });

  const infoPass = raw.infoPass ?? null;
  const locatePass = raw.locatePass ?? null;
  const alarmPass = raw.alarmPass ?? null;

  const interactionBundle = {
    infoPass,
    locatePass,
    alarmPass,
    resolveTarget: createHighlightTargetResolver(options.resolveOptions ?? {}),
    clearSelectedObjects() {
      if (infoPass?.selectedObjects) {
        infoPass.selectedObjects = [];
      }
      if (locatePass?.selectedObjects) {
        locatePass.selectedObjects = [];
      }
      if (alarmPass?.selectedObjects) {
        alarmPass.selectedObjects = [];
      }
      for (const pass of [infoPass, locatePass, alarmPass]) {
        if (pass) {
          pass.enabled = false;
        }
      }
    },
    dispose() {
      this.clearSelectedObjects();
      for (const pass of [infoPass, locatePass, alarmPass, raw.renderPass]) {
        try {
          pass?.dispose?.();
        } catch {
          /* ignore */
        }
      }
    }
  };

  const controller = createSceneHighlightInteractionController(interactionBundle);

  let outputPass = null;
  if (options.includeOutputPass !== false) {
    outputPass = new OutputPass();
    trackDisposableResource(outputPass);
    composer.addPass(outputPass);
  }

  return {
    bundle: raw,
    controller,
    renderPass: raw.renderPass ?? null,
    infoPass,
    locatePass,
    alarmPass,
    outputPass,
    /** @deprecated same as infoPass; fewer variable names on integration pages */
    outlinePass: infoPass
  };
}

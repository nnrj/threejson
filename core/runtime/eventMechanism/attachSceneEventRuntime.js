/**
 * Integrate event mechanism into createJsonScene lifecycle (auto bind / dispose).
 */

import {
  FRAME_PHASE,
  LOAD_PHASE,
  TEARDOWN_PHASE
} from "../sceneLoadLifecycle.js";
import { log } from "../../util/logger.js";
import { bindSceneEventRuntime, disposeSceneEventRuntime } from "./bindSceneEventRuntime.js";
import { createCanvasRaycastEventHost } from "./createCanvasRaycastEventHost.js";
import { resolveBindSceneEvents } from "./resolveBindSceneEvents.js";

/**
 * @param {object} ctx
 * @returns {boolean}
 */
function shouldBindSceneEvents(ctx) {
  const options = ctx.options ?? {};
  return resolveBindSceneEvents(
    ctx.payload ?? ctx.sourceSceneJson ?? ctx.sceneJson,
    ctx.sceneConfig,
    options
  );
}

/**
 * @param {object} ctx
 * @param {{ handle: object|null, hostFactory: Function|null }} holder
 * @returns {import("./eventListenerManager.js").EventListenerHost|null}
 */
function resolveEventHost(ctx, holder) {
  const options = ctx.options ?? {};
  if (options.eventHost && typeof options.eventHost === "object") {
    return options.eventHost;
  }
  if (typeof holder.hostFactory === "function") {
    return holder.hostFactory(ctx);
  }
  const deployed = ctx.deployed ?? ctx.runtime;
  const canvas =
    deployed?.renderer?.domElement ??
    options.canvas ??
    null;
  if (!canvas || !deployed?.camera || !deployed?.scene) {
    return null;
  }
  return createCanvasRaycastEventHost({
    canvas,
    camera: deployed.camera,
    scene: deployed.scene,
    sceneRuntime: deployed
  });
}

/**
 * @param {import("../sceneLoadLifecycle.js").SceneLifecycleBus} bus
 * @param {{ handle: object|null, hostFactory: Function|null }} holder
 */
export function wireEventMechanismSceneLifecycle(bus, holder) {
  if (!bus || !holder) {
    return;
  }

  bus.on(LOAD_PHASE.onSceneReady, {
    name: "eventMechanism:bind",
    priority: 10,
    handler: async (ctx) => {
      if (!shouldBindSceneEvents(ctx)) {
        holder.handle = null;
        return;
      }
      const deployed = ctx.deployed ?? ctx.runtime;
      const scene = deployed?.scene;
      if (!scene) {
        return;
      }
      const host = resolveEventHost(ctx, holder);
      const sceneJsonRoot =
        ctx.sceneJson ?? ctx.sourceSceneJson ?? ctx.normalized?.compatPayload ?? null;
      const objectList =
        ctx.objectList ??
        ctx.payload?.objectList ??
        ctx.normalizedPayload?.objectList ??
        null;
      holder.handle = await bindSceneEventRuntime(scene, {
        scene,
        camera: deployed.camera,
        renderer: deployed.renderer,
        controls: deployed.controls,
        sceneRuntime: deployed,
        sceneConfig: ctx.sceneConfig ?? deployed.sceneConfig,
        sceneJsonRoot,
        jsonData: sceneJsonRoot,
        payload: ctx.payload ?? ctx.normalizedPayload ?? null,
        objectList,
        records: objectList,
        host,
        sceneToken: deployed.sceneSessionId ?? deployed.sceneToken,
        objectLifecycle: ctx.options?._objectLifecycle ?? null,
        options: ctx.options ?? null
      });
      if (deployed && holder.handle) {
        deployed.eventMechanism = holder.handle;
      }
    }
  });

  bus.on(TEARDOWN_PHASE.beforeDispose, {
    name: "eventMechanism:dispose",
    priority: 10,
    handler: async (ctx) => {
      const runtime = ctx.runtime;
      const handle = holder.handle ?? runtime?.eventMechanism ?? null;
      if (handle?.manager && typeof handle.manager.dispatchPlatformEvent === "function") {
        try {
          await handle.manager.dispatchPlatformEvent(null, "scene.dispose", {
            ...ctx,
            scene: ctx.scene ?? runtime?.scene ?? null,
            camera: ctx.camera ?? runtime?.camera ?? null,
            renderer: ctx.renderer ?? runtime?.renderer ?? null,
            controls: ctx.controls ?? runtime?.controls ?? null,
            sceneRuntime: runtime ?? ctx.sceneRuntime ?? null,
            sceneToken: handle.sceneToken
          });
        } catch (error) {
          log.warn("[eventMechanism] scene.dispose dispatch failed; continuing teardown", { error });
        }
      }
      await disposeSceneEventRuntime(handle);
      holder.handle = null;
      if (runtime) {
        runtime.eventMechanism = null;
      }
    }
  });
}

/**
 * @param {object} [options]
 * @returns {{ loadOptions: object, holder: { handle: object|null, hostFactory: Function|null }, wireEventMechanism: (bus: object) => void }}
 */
export function integrateEventMechanismIntoSceneLoad(options = {}) {
  const holder = {
    handle: null,
    hostFactory: typeof options.eventHostFactory === "function" ? options.eventHostFactory : null
  };
  return {
    loadOptions: { ...options },
    holder,
    wireEventMechanism(bus) {
      wireEventMechanismSceneLifecycle(bus, holder);
    }
  };
}

export { resolveBindSceneEvents };

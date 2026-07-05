import { bootstrapCss3dFromScene } from "./bootstrapFromScene.js";
import {
  FRAME_PHASE,
  LOAD_PHASE
} from "../../runtime/sceneLoadLifecycle.js";

/**
 * @param {object} deployed
 * @param {{ state: ReturnType<typeof bootstrapCss3dFromScene> }} holder
 */
function wireCss3dResizeAndDispose(deployed, holder) {
  const innerResize = typeof deployed.renderLoop?.resize === "function"
    ? deployed.renderLoop.resize.bind(deployed.renderLoop)
    : null;
  if (innerResize && deployed.renderLoop) {
    deployed.renderLoop.resize = (size) => {
      innerResize(size);
      const canvas = deployed.renderer?.domElement;
      holder.state?.resize?.({
        width: size?.width ?? canvas?.clientWidth,
        height: size?.height ?? canvas?.clientHeight
      });
    };
  }

  const innerDispose = typeof deployed.dispose === "function"
    ? deployed.dispose.bind(deployed)
    : null;
  deployed.dispose = () => {
    holder.state?.dispose?.();
    holder.state = null;
    innerDispose?.();
  };
}

/**
 * @param {import('../../runtime/sceneLoadLifecycle.js').SceneLifecycleBus} bus
 * @param {{ state: ReturnType<typeof bootstrapCss3dFromScene>|null }} holder
 */
export function wireCss3dSceneLifecycle(bus, holder) {
  if (!bus || !holder) {
    return;
  }
  bus.on(LOAD_PHASE.onSceneReady, {
    name: "css3d:bootstrap",
    priority: 0,
    handler: async (ctx) => {
      holder.state = bootstrapCss3dFromScene(ctx);
      const deployed = ctx.deployed ?? ctx.runtime;
      if (holder.state && deployed) {
        wireCss3dResizeAndDispose(deployed, holder);
        deployed.css3d = holder.state;
      }
    }
  });
  bus.on(FRAME_PHASE.afterRender, {
    name: "css3d:render",
    priority: 0,
    handler: () => {
      holder.state?.render?.();
    }
  });
}

/**
 * Wire CSS3D second pass into createJsonScene load flow (plan C: lazy start via post-deploy traverse).
 *
 * @param {object} [options]
 * @returns {{ loadOptions: object, holder: { state: null }, wireCss3d: (bus: object) => void }}
 */
export function integrateCss3dIntoSceneLoad(options = {}) {
  const holder = { state: null };
  return {
    loadOptions: { ...options },
    holder,
    wireCss3d(bus) {
      wireCss3dSceneLifecycle(bus, holder);
    }
  };
}

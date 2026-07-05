import { resolveSceneExtensions } from "../../util/extensionsUtil.js";
import { collectCss3dPanelElements } from "./css3dPanelBuilder.js";
import { createCss3dRuntime } from "./css3dRuntime.js";
import { EXTENSION_ID } from "./constants.js";
import { applyPointerPolicy, normalizePointerPolicy } from "./pointerPolicy.js";

/**
 * Attach CSS3D second pass to loaded scene and apply pointer policy.
 *
 * @param {{
 *   scene?: import("three").Scene,
 *   camera?: import("three").Camera,
 *   renderer?: import("three").WebGLRenderer|null,
 *   controls?: object|null,
 *   sceneJson?: object,
 *   sceneConfig?: object,
 *   worldInfo?: object,
 *   renderLoop?: { resize?: Function }|null,
 * }} ctx
 * @returns {{ render: Function, resize: Function, dispose: Function }|null}
 */
export function bootstrapCss3dFromScene(ctx) {
  const scene = ctx?.scene;
  const camera = ctx?.camera;
  const webglRenderer = ctx?.renderer ?? null;
  if (!scene || !camera || !webglRenderer) {
    return null;
  }

  const panelElements = collectCss3dPanelElements(scene);
  if (panelElements.length === 0) {
    return null;
  }

  const sceneJson = ctx?.sceneJson && typeof ctx.sceneJson === "object" ? ctx.sceneJson : {};
  const sceneConfig = ctx?.sceneConfig && typeof ctx.sceneConfig === "object"
    ? ctx.sceneConfig
    : sceneJson.sceneConfig && typeof sceneJson.sceneConfig === "object"
      ? sceneJson.sceneConfig
      : {};
  const worldInfo = ctx?.worldInfo && typeof ctx.worldInfo === "object"
    ? ctx.worldInfo
    : sceneJson.worldInfo && typeof sceneJson.worldInfo === "object"
      ? sceneJson.worldInfo
      : {};

  const ext = resolveSceneExtensions(sceneConfig, worldInfo)[EXTENSION_ID];
  if (ext && typeof ext === "object" && ext.enabled === false) {
    return null;
  }

  const pointerPolicy = normalizePointerPolicy(
    ext && typeof ext === "object" ? ext.pointerPolicy : undefined
  );

  const runtime = createCss3dRuntime({
    renderer: webglRenderer,
    canvas: webglRenderer.domElement
  });

  const pointer = applyPointerPolicy(pointerPolicy, panelElements, runtime.domElement);
  pointer.attachControls(ctx?.controls ?? null);

  return {
    pointerPolicy,
    render() {
      runtime.render(scene, camera);
    },
    resize(size) {
      runtime.resize(size);
    },
    dispose() {
      pointer.dispose();
      runtime.dispose();
    }
  };
}

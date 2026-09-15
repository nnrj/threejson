/**
 * Thin wrapper around the `three-viewport-gizmo` widget (click a face/axis to snap the camera
 * to that view). Shared by the editor and the shower so both draw/dispose it the same way.
 */
import { Vector4, WebGLRenderer } from "three";
import { ViewportGizmo } from "three-viewport-gizmo";

let gizmo = null;
let isolatedRenderer = null, isolatedRoot = null;

export function disposeViewportGizmoOverlay() {
  gizmo?.dispose?.();
  gizmo = null;
  isolatedRenderer?.dispose(); isolatedRenderer?.forceContextLoss(); isolatedRenderer = null;
  isolatedRoot?.remove(); isolatedRoot = null;
}

/**
 * (Re)creates the gizmo for the given runtime. Disposes any previous instance first, since the
 * camera/renderer/controls are typically fresh objects after a scene (re)load.
 * @param {{ camera?: object, renderer?: object, controls?: object }} runtime
 * @param {HTMLElement} container Positioned (position:relative) element the gizmo overlays.
 * @param {object} [options] Passed through to `three-viewport-gizmo` (size, placement, etc).
 * @returns {object|null} the created gizmo instance, or null if camera/renderer/container are missing
 */
export function createViewportGizmoOverlay(runtime, container, options = {}) {
  disposeViewportGizmoOverlay();
  if (!runtime?.camera || !runtime?.renderer || !container) {
    return null;
  }
  const controls = runtime.controls;
  // This widget snaps an orbit camera around controls.target. Walking/flying controls
  // do not implement that contract and must not be attached or repositioned by it.
  if (controls && (controls.threeJsonControlsKind === "firstPerson"
    || !controls.target?.isVector3
    || typeof controls.addEventListener !== "function"
    || typeof controls.removeEventListener !== "function")) {
    return null;
  }
  let renderer = runtime.renderer;
  const configuration = {
    container,
    size: 90,
    placement: "top-right",
    ...options
  };
  if (renderer.isWebGPURenderer) {
    // This third-party widget uses WebGL LineMaterial. A small, independent overlay
    // preserves the widget without sending GLSL materials through the WebGPU renderer.
    isolatedRoot = document.createElement("div");
    isolatedRoot.className = "threeJsonGizmoOverlayCanvas";
    const [vertical, horizontal] = configuration.placement.split("-");
    const style = { position: "absolute", width: `${configuration.size}px`, height: `${configuration.size}px`, zIndex: "20" };
    style[vertical === "center" ? "top" : vertical] = vertical === "center" ? "50%" : `${options.offset?.[vertical] ?? 10}px`;
    style[horizontal === "center" ? "left" : horizontal] = horizontal === "center" ? "50%" : `${options.offset?.[horizontal] ?? 10}px`;
    style.transform = `translate(${horizontal === "center" ? "-50%" : "0"}, ${vertical === "center" ? "-50%" : "0"})`;
    Object.assign(isolatedRoot.style, style); container.appendChild(isolatedRoot);
    try {
      isolatedRenderer = new WebGLRenderer({ alpha: true, antialias: true });
      isolatedRenderer.setPixelRatio(window.devicePixelRatio || 1);
      isolatedRenderer.setSize(configuration.size, configuration.size);
      isolatedRenderer.setClearColor(0, 0);
      isolatedRenderer.domElement.style.pointerEvents = "none";
      isolatedRoot.appendChild(isolatedRenderer.domElement);
      renderer = isolatedRenderer;
      configuration.container = isolatedRoot; configuration.placement = "top-left";
      configuration.offset = { top: 0, bottom: 0, left: 0, right: 0 };
    } catch (error) { disposeViewportGizmoOverlay(); throw error; }
  }
  try { gizmo = new ViewportGizmo(runtime.camera, renderer, configuration); }
  catch (error) { disposeViewportGizmoOverlay(); throw error; }
  if (runtime.controls) {
    gizmo.attachControls(runtime.controls);
  }
  return gizmo;
}

/** Call once per animation frame, after the main scene render, e.g. from an `afterRender` hook. */
export function renderViewportGizmoOverlay() {
  if (!gizmo) {
    return;
  }
  const renderer = gizmo.renderer;
  const viewport = renderer?.getViewport?.(new Vector4());
  const scissor = renderer?.getScissor?.(new Vector4());
  const scissorTest = renderer?.getScissorTest?.();
  const renderTarget = renderer?.getRenderTarget?.();
  const autoClear = renderer?.autoClear;
  // The main scene render may have left a non-default render target bound (e.g. an
  // EffectComposer's read/write buffer); the gizmo draws straight to the canvas via
  // renderer.render(), so it needs the default (screen) target restored first, or it silently
  // paints into the off-screen buffer instead of what actually reaches the display.
  renderer?.setRenderTarget?.(null);
  try {
    isolatedRenderer?.clear();
    gizmo.render();
  } finally {
    // ViewportGizmo shares the scene renderer. Never let its small viewport/scissor
    // leak into the following main-scene frame, especially after Code/All resizing.
    renderer?.setRenderTarget?.(renderTarget ?? null);
    if (viewport) renderer?.setViewport?.(viewport);
    if (scissor) renderer?.setScissor?.(scissor);
    if (typeof scissorTest === "boolean") renderer?.setScissorTest?.(scissorTest);
    if (typeof autoClear === "boolean" && renderer) renderer.autoClear = autoClear;
  }
}

/** Recompute gizmo bounds after its renderer canvas or overlay container changes size. */
export function updateViewportGizmoOverlay() {
  gizmo?.update?.();
}

export function getViewportGizmoOverlay() {
  return gizmo;
}

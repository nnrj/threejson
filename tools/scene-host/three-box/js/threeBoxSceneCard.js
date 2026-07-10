import { sceneHostAssetUrl } from "../../shared/js/sceneHostPaths.js";

/**
 * Inline scene canvas embedded at the top of an AI-generated chat reply. Minimal render/dispose
 * for now (the hover action bar — copy JSON / export / open-in-editor / open-in-player /
 * fullscreen / JSON-canvas toggle — lands in a later milestone); this establishes the
 * create→dispose lifecycle pattern (mirrors shower's runScene: dispose the previous runtime
 * before creating the next one on the same canvas) that the action bar will build on.
 */
export function createThreeBoxSceneCard() {
  const el = document.createElement("div");
  el.className = "sceneCard";
  const canvas = document.createElement("canvas");
  canvas.className = "sceneCardCanvas";
  el.appendChild(canvas);
  const loadingMask = document.createElement("div");
  loadingMask.className = "sceneCardLoadingMask";
  loadingMask.textContent = "正在渲染场景…";
  el.appendChild(loadingMask);

  let runtime = null;
  let liveResizeObserver = null;

  /** Keeps the canvas in sync with its container's actual size after first paint (e.g. the left
   * dock being pinned/unpinned reflows the message column width) — createJsonScene's own
   * autoResize is force-disabled above so it never follows window resizes, so this is the only
   * thing that keeps the card responsive post-render. */
  function watchLiveResize() {
    liveResizeObserver?.disconnect();
    liveResizeObserver = new ResizeObserver((entries) => {
      if (!runtime) {
        return;
      }
      const entry = entries[0];
      const box = entry.contentBoxSize?.[0];
      const width = Math.max(1, Math.round(box ? box.inlineSize : entry.contentRect.width));
      const height = Math.max(1, Math.round(box ? box.blockSize : entry.contentRect.height));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      runtime.resize?.({ width, height });
    });
    liveResizeObserver.observe(el);
  }

  /** Resolves with the element's actual laid-out content-box size. More reliable than
   * requestAnimationFrame-counting for catching the moment CSS (aspect-ratio, flex, an ancestor's
   * `hidden` toggle) has actually settled — ResizeObserver's first callback fires with the real
   * computed size, whereas a fixed number of rAFs can still race ahead of layout in some cases. */
  function waitForStableSize(target) {
    return new Promise((resolve) => {
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        const box = entry.contentBoxSize?.[0];
        const width = box ? Math.round(box.inlineSize) : Math.round(entry.contentRect.width);
        const height = box ? Math.round(box.blockSize) : Math.round(entry.contentRect.height);
        ro.disconnect();
        resolve({ width: Math.max(1, width), height: Math.max(1, height) });
      });
      ro.observe(target);
    });
  }

  async function render(sceneJsonPayload) {
    const { createJsonScene } = await import("threejson/core");
    runtime?.dispose?.();
    const { width, height } = await waitForStableSize(el);
    // Pin the canvas's own CSS box explicitly: core's render loop resizes against
    // canvas.clientWidth/clientHeight on its first frame regardless of payload.canvasWidth/Height
    // (see core/handler/frameLoopHandler.js), so a canvas that merely inherits width:100% from an
    // as-yet-unsettled ancestor can catch a stale full-viewport size on that first frame.
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const payload = structuredClone(sceneJsonPayload || {});
    payload.canvasWidth = width;
    payload.canvasHeight = height;
    // Source scenes (e.g. full-page templates like roomShow.json) often set
    // sceneConfig.renderLoop.autoResize for a full-window host; an inline embedded card must not
    // follow window resizes, so this is force-disabled regardless of what the scene JSON says.
    payload.sceneConfig = {
      ...payload.sceneConfig,
      renderLoop: { ...payload.sceneConfig?.renderLoop, autoResize: false, firstAutoResize: false }
    };
    try {
      runtime = await createJsonScene(payload, {
        canvas,
        resetScene: true,
        assetsBase: sceneHostAssetUrl("assets/"),
        autoFillLights: true,
        autoFillCamera: true,
        autoFitCamera: true
      });
      runtime.start?.();
      // core/handler/frameLoopHandler.js's resize(size={}) reads size.width/size.height off a
      // single options object — passing (width, height) as positional args silently falls back
      // to window.innerWidth/innerHeight (size.width is undefined on a bare number).
      runtime.resize?.({ width, height });
      watchLiveResize();
    } finally {
      loadingMask.hidden = true;
    }
    return runtime;
  }

  function dispose() {
    liveResizeObserver?.disconnect();
    liveResizeObserver = null;
    runtime?.dispose?.();
    runtime = null;
  }

  return { el, canvas, render, dispose, getRuntime: () => runtime };
}

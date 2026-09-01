/**
 * Pauses an embedded scene runtime while its canvas is outside the viewport or the document is
 * hidden. A conversation can retain many live scene cards, but only visible cards should spend a
 * requestAnimationFrame loop and contend for GPU/compositor time.
 */

function isElementNearViewport(element, margin = 96) {
  if (!element?.isConnected || typeof element.getBoundingClientRect !== "function") return false;
  const rect = element.getBoundingClientRect();
  const viewportWidth = Number(globalThis.innerWidth) || document.documentElement?.clientWidth || 0;
  const viewportHeight = Number(globalThis.innerHeight) || document.documentElement?.clientHeight || 0;
  return rect.width > 0
    && rect.height > 0
    && rect.right >= -margin
    && rect.left <= viewportWidth + margin
    && rect.bottom >= -margin
    && rect.top <= viewportHeight + margin;
}

/**
 * @param {{element: Element, getRuntime: () => object|null, rootMargin?: string, viewportMargin?: number}} options
 */
export function createCanvasRenderActivity(options = {}) {
  const element = options.element;
  const getRuntime = typeof options.getRuntime === "function" ? options.getRuntime : () => null;
  const viewportMargin = Math.max(0, Number(options.viewportMargin) || 96);
  let intersecting = isElementNearViewport(element, viewportMargin);
  let observer = null;
  let started = false;
  let lastRuntime = null;
  let lastShouldRun = null;

  const shouldRun = () => document.hidden !== true && intersecting && element?.isConnected === true;

  function sync({ forceFrame = false } = {}) {
    const runtime = getRuntime();
    const nextShouldRun = Boolean(runtime && shouldRun());
    const runtimeChanged = runtime !== lastRuntime;
    const activityChanged = nextShouldRun !== lastShouldRun;
    if (runtime) {
      if (nextShouldRun) {
        runtime.start?.();
        if (runtimeChanged || activityChanged || forceFrame) runtime.renderOnce?.();
      } else {
        runtime.stop?.();
      }
    }
    lastRuntime = runtime;
    lastShouldRun = nextShouldRun;
    return nextShouldRun;
  }

  const onDocumentVisibility = () => sync({ forceFrame: document.hidden !== true });

  function start() {
    if (started) return;
    started = true;
    document.addEventListener?.("visibilitychange", onDocumentVisibility);
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === element) || entries[0];
        if (!entry) return;
        intersecting = entry.isIntersecting === true && entry.intersectionRatio > 0;
        sync({ forceFrame: intersecting });
      }, { rootMargin: options.rootMargin || "96px 0px" });
      observer.observe(element);
    }
    sync({ forceFrame: true });
  }

  function dispose() {
    observer?.disconnect();
    observer = null;
    document.removeEventListener?.("visibilitychange", onDocumentVisibility);
    getRuntime()?.stop?.();
    started = false;
    lastRuntime = null;
    lastShouldRun = null;
  }

  return { start, sync, dispose };
}

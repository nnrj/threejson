import { DEFAULT_POINTER_POLICY } from "./constants.js";

/** @returns {import("./constants.js").Css3dPointerPolicy} */
export function normalizePointerPolicy(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "orbit" || key === "auto" || key === "panel") {
    return key;
  }
  return DEFAULT_POINTER_POLICY;
}

/**
 * @param {import("./constants.js").Css3dPointerPolicy} policy
 * @param {HTMLElement[]} panelElements
 * @param {import("three/examples/jsm/renderers/CSS3DRenderer.js").CSS3DRenderer} cssRendererDomParent
 */
export function applyPointerPolicy(policy, panelElements, cssRendererDomParent) {
  const resolved = policy === "auto" ? "panel" : policy;
  const root = cssRendererDomParent;
  if (!root) {
    return () => {};
  }

  root.style.pointerEvents = resolved === "panel" ? "none" : "none";

  for (let i = 0; i < panelElements.length; i++) {
    const el = panelElements[i];
    if (!el) {
      continue;
    }
    el.style.pointerEvents = resolved === "panel" ? "auto" : "none";
    el.style.touchAction = resolved === "panel" ? "auto" : "none";
  }

  /** @type {import("three").EventDispatcher|null} */
  let controls = null;
  let controlsWasEnabled = true;

  function setControlsEnabled(enabled) {
    if (!controls || !("enabled" in controls)) {
      return;
    }
    controls.enabled = enabled;
  }

  function onPointerDown(event) {
    if (resolved !== "auto") {
      return;
    }
    const target = /** @type {HTMLElement} */ (event.target);
    const hitPanel = panelElements.some((el) => el && (el === target || el.contains(target)));
    if (hitPanel) {
      controlsWasEnabled = controls?.enabled !== false;
      setControlsEnabled(false);
    }
  }

  function onPointerUp() {
    if (resolved !== "auto") {
      return;
    }
    setControlsEnabled(controlsWasEnabled);
  }

  if (resolved === "auto") {
    root.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("pointerup", onPointerUp, true);
    root.addEventListener("pointercancel", onPointerUp, true);
  }

  return {
    attachControls(nextControls) {
      controls = nextControls ?? null;
    },
    dispose() {
      if (resolved === "auto") {
        root.removeEventListener("pointerdown", onPointerDown, true);
        root.removeEventListener("pointerup", onPointerUp, true);
        root.removeEventListener("pointercancel", onPointerUp, true);
      }
      setControlsEnabled(true);
    }
  };
}

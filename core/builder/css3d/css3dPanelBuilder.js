import * as THREE from "three";
import { CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";

import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";
import { registerObject } from "../../handler/objectRegistry.js";
import { setUserDataObjJson } from "../../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../../util/util.js";
import {
  DEFAULT_IFRAME_SANDBOX,
  DEFAULT_PANEL_HEIGHT_PX,
  DEFAULT_PANEL_WIDTH_PX
} from "./constants.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

function valueOr(value, fallback) {
  return hasValue(value) ? value : fallback;
}

/**
 * @param {object} record
 * @returns {{ type: "html" | "url", html?: string, src?: string, sandbox?: string }}
 */
function resolvePanelContent(record) {
  const content = record.content && typeof record.content === "object" ? record.content : null;
  if (content) {
    const type = String(content.type || "").trim().toLowerCase();
    if (type === "url") {
      return {
        type: "url",
        src: String(content.src || content.url || "").trim(),
        sandbox: typeof content.sandbox === "string" ? content.sandbox : DEFAULT_IFRAME_SANDBOX
      };
    }
    return {
      type: "html",
      html: String(content.html ?? content.text ?? record.text ?? "").trim()
    };
  }
  if (typeof record.url === "string" && record.url.trim()) {
    return { type: "url", src: record.url.trim(), sandbox: DEFAULT_IFRAME_SANDBOX };
  }
  return {
    type: "html",
    html: String(record.html ?? record.text ?? "<div>CSS3D Panel</div>")
  };
}

/**
 * @param {object} record
 * @param {{ type: "html" | "url", html?: string, src?: string, sandbox?: string }} content
 * @param {number} widthPx
 * @param {number} heightPx
 * @returns {HTMLDivElement}
 */
function createPanelElement(record, content, widthPx, heightPx) {
  const shell = document.createElement("div");
  shell.className = "threejson-css3d-panel";
  shell.style.width = `${widthPx}px`;
  shell.style.height = `${heightPx}px`;
  shell.style.overflow = "hidden";
  shell.style.boxSizing = "border-box";
  const backColor = record.backColor || record.backgroundColor || "rgba(32, 36, 44, 0.92)";
  shell.style.background = backColor;
  shell.style.color = record.color || "#e8eaed";
  shell.style.borderRadius = `${Number(record.borderRadius) || 6}px`;
  shell.style.border = record.border || "1px solid rgba(255,255,255,0.12)";
  shell.style.font = record.font || "14px Microsoft YaHei, Arial, sans-serif";

  if (content.type === "url") {
    if (!content.src) {
      shell.textContent = "[css3dPanel] missing content.src";
      return shell;
    }
    const iframe = document.createElement("iframe");
    iframe.src = content.src;
    iframe.title = String(record.name || record.refName || "css3dPanel");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.setAttribute("sandbox", content.sandbox || DEFAULT_IFRAME_SANDBOX);
    iframe.setAttribute("loading", "lazy");
    shell.appendChild(iframe);
    return shell;
  }

  shell.innerHTML = content.html || "";
  return shell;
}

function applyTransform(cssObject, record) {
  const position = record.position || record.panel?.position || {};
  cssObject.position.set(
    Number(valueOr(position.x, 0)),
    Number(valueOr(position.y, 0)),
    Number(valueOr(position.z, 0))
  );

  const rotation = record.rotation || record.panel?.rotation || {};
  cssObject.rotation.set(
    THREE.MathUtils.degToRad(Number(valueOr(rotation.rotationX, 0))),
    THREE.MathUtils.degToRad(Number(valueOr(rotation.rotationY, 0))),
    THREE.MathUtils.degToRad(Number(valueOr(rotation.rotationZ, 0)))
  );

  const widthPx = Math.max(40, Number(valueOr(record.width, DEFAULT_PANEL_WIDTH_PX)));
  const worldWidth = Number(valueOr(record.panelWidth, widthPx * 0.05));
  const uniformScale = worldWidth / widthPx;

  const scale = record.scale || record.panel?.scale || {};
  const sx = hasValue(scale.scaleX) ? Number(scale.scaleX) : uniformScale;
  const sy = hasValue(scale.scaleY) ? Number(scale.scaleY) : uniformScale;
  const sz = hasValue(scale.scaleZ) ? Number(scale.scaleZ) : uniformScale;
  cssObject.scale.set(sx, sy, sz);
}

/**
 * @param {object} record
 * @param {import("three").Object3D} scene
 * @returns {import("three/examples/jsm/renderers/CSS3DRenderer.js").CSS3DObject|null}
 */
export function deployCss3dPanel(record, scene) {
  if (!record || typeof record !== "object" || !scene) {
    return null;
  }

  const widthPx = Math.max(40, Number(valueOr(record.width, DEFAULT_PANEL_WIDTH_PX)));
  const heightPx = Math.max(30, Number(valueOr(record.height, DEFAULT_PANEL_HEIGHT_PX)));
  const content = resolvePanelContent(record);
  const element = createPanelElement(record, content, widthPx, heightPx);

  const cssObject = new CSS3DObject(element);
  trackDisposableResource(cssObject);
  applyTransform(cssObject, record);
  applyVisibilityFromDescriptor(cssObject, record);
  setUserDataObjJson(cssObject, { ...record, objType: "css3dPanel" });
  registerObject(cssObject, record);

  scene.add(cssObject);
  return cssObject;
}

/**
 * @param {import("three").Object3D} root
 * @returns {HTMLElement[]}
 */
export function collectCss3dPanelElements(root) {
  /** @type {HTMLElement[]} */
  const elements = [];
  if (!root || typeof root.traverse !== "function") {
    return elements;
  }
  root.traverse((node) => {
    if (node?.isCSS3DObject === true && node.element instanceof HTMLElement) {
      elements.push(node.element);
    }
  });
  return elements;
}

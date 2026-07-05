import { CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";

/**
 * @param {{
 *   renderer?: import("three").WebGLRenderer|null,
 *   canvas?: HTMLCanvasElement|null,
 * }} options
 */
export function createCss3dRuntime(options = {}) {
  const webglRenderer = options.renderer ?? null;
  const canvas = options.canvas ?? webglRenderer?.domElement ?? null;
  const cssRenderer = new CSS3DRenderer();

  const parent = canvas?.parentElement || document.body;
  const width = canvas?.clientWidth || window.innerWidth;
  const height = canvas?.clientHeight || window.innerHeight;
  cssRenderer.setSize(width, height);

  const domElement = cssRenderer.domElement;
  domElement.style.position = "absolute";
  domElement.style.top = "0";
  domElement.style.left = "0";
  domElement.style.pointerEvents = "none";
  domElement.style.zIndex = "2";
  if (canvas && canvas.style) {
    const canvasZ = Number.parseInt(canvas.style.zIndex || "1", 10);
    domElement.style.zIndex = String(Number.isFinite(canvasZ) ? canvasZ + 1 : 2);
  }
  parent.appendChild(domElement);

  return {
    cssRenderer,
    domElement,
    render(scene, camera) {
      if (!scene || !camera) {
        return;
      }
      cssRenderer.render(scene, camera);
    },
    resize(size = {}) {
      const nextWidth = size.width ?? canvas?.clientWidth ?? window.innerWidth;
      const nextHeight = size.height ?? canvas?.clientHeight ?? window.innerHeight;
      cssRenderer.setSize(nextWidth, nextHeight);
    },
    dispose() {
      if (domElement.parentNode) {
        domElement.parentNode.removeChild(domElement);
      }
    }
  };
}

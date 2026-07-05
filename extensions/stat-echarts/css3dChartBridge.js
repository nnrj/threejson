/**
 * 在 CSS3D 面板 DOM 上挂载 ECharts。
 */
import { collectCss3dPanelElements } from "../../core/builder/css3d/css3dPanelBuilder.js";

/** @type {WeakMap<HTMLElement, ResizeObserver>} */
const resizeObserverByShell = new WeakMap();

/**
 * @param {HTMLElement|null|undefined} el
 * @returns {HTMLElement|null}
 */
function findCss3dPanelShell(el) {
  let node = el;
  while (node) {
    if (node.classList?.contains("threejson-css3d-panel")) {
      return node;
    }
    node = node.parentElement;
  }
  return el || null;
}

/**
 * @param {HTMLElement|null|undefined} el
 * @returns {boolean}
 */
function hasPercentInlineSize(el) {
  const w = el?.style?.width || "";
  const h = el?.style?.height || "";
  return w.includes("%") || h.includes("%");
}

/**
 * CSS3D 面板在首帧可能尚未 layout；优先取 shell 的 inline px，避免内层 100% 节点 computed 误判为 100×100。
 * @param {HTMLElement} el
 * @returns {{ width: number, height: number }}
 */
function resolveElementSize(el) {
  if (!el) {
    return { width: 0, height: 0 };
  }

  const shell = findCss3dPanelShell(el);
  if (shell) {
    const styleW = parseFloat(shell.style?.width || "");
    const styleH = parseFloat(shell.style?.height || "");
    if (styleW > 0 && styleH > 0) {
      return { width: Math.round(styleW), height: Math.round(styleH) };
    }
    const shellW = shell.offsetWidth || shell.clientWidth || 0;
    const shellH = shell.offsetHeight || shell.clientHeight || 0;
    if (shellW > 0 && shellH > 0) {
      return { width: shellW, height: shellH };
    }
  }

  /** @type {HTMLElement|null} */
  let node = el;
  while (node) {
    const width = node.offsetWidth || node.clientWidth || 0;
    const height = node.offsetHeight || node.clientHeight || 0;
    if (width > 0 && height > 0) {
      return { width, height };
    }
    const styleW = parseFloat(node.style?.width || "");
    const styleH = parseFloat(node.style?.height || "");
    if (styleW > 0 && styleH > 0) {
      return { width: Math.round(styleW), height: Math.round(styleH) };
    }
    if (!hasPercentInlineSize(node) && typeof getComputedStyle === "function") {
      const computed = getComputedStyle(node);
      const computedW = parseFloat(computed.width || "");
      const computedH = parseFloat(computed.height || "");
      if (computedW > 0 && computedH > 0) {
        return { width: Math.round(computedW), height: Math.round(computedH) };
      }
    }
    node = node.parentElement;
  }
  return { width: 0, height: 0 };
}

/**
 * @param {object} chart
 * @param {HTMLElement} chartHost
 * @param {number} width
 * @param {number} height
 */
function applyChartDimensions(chart, chartHost, width, height) {
  if (!chart || !chartHost || width <= 0 || height <= 0) {
    return;
  }
  chartHost.style.width = `${width}px`;
  chartHost.style.height = `${height}px`;
  chart.resize({ width, height });
}

/**
 * @param {HTMLElement} shell
 * @param {object} chart
 * @param {HTMLElement} chartHost
 * @param {HTMLElement} sizeEl
 */
function ensureChartResizeObserver(shell, chart, chartHost, sizeEl) {
  if (!shell || resizeObserverByShell.has(shell) || typeof ResizeObserver === "undefined") {
    return;
  }
  const observer = new ResizeObserver(() => {
    const { width, height } = resolveElementSize(sizeEl);
    applyChartDimensions(chart, chartHost, width, height);
  });
  observer.observe(shell);
  resizeObserverByShell.set(shell, observer);
}

/**
 * @param {import("three").Object3D} scene
 * @param {string} panelRef
 * @returns {HTMLElement|null}
 */
export function findCss3dPanelElement(scene, panelRef) {
  if (!scene || !panelRef) {
    return null;
  }
  const ref = String(panelRef).trim();
  /** @type {HTMLElement|null} */
  let fallback = null;

  scene.traverse((node) => {
    if (node?.isCSS3DObject !== true || !(node.element instanceof HTMLElement)) {
      return;
    }
    const el = node.element;
    if (!fallback) {
      fallback = el;
    }
    const meta = node.userData?.objJson;
    const names = [meta?.name, meta?.refName].filter(Boolean).map(String);
    if (names.includes(ref)) {
      fallback = el;
      return;
    }
    if (el.id === ref) {
      fallback = el;
      return;
    }
    const byId = el.querySelector?.(`#${CSS.escape(ref)}`);
    if (byId) {
      fallback = findCss3dPanelShell(byId) || el;
    }
  });

  if (fallback) {
    return fallback;
  }

  const elements = collectCss3dPanelElements(scene);
  for (let i = 0; i < elements.length; i++) {
    const hit = elements[i].querySelector?.(`#${CSS.escape(ref)}`);
    if (hit) {
      return findCss3dPanelShell(hit) || elements[i];
    }
  }
  return elements[0] || null;
}

/**
 * @param {HTMLElement} container
 * @param {object} echartsModule
 * @param {object} option
 * @returns {object|null}
 */
export function mountEchartsOnElement(container, echartsModule, option) {
  if (!container || !echartsModule?.init) {
    return null;
  }
  const shell = findCss3dPanelShell(container) || container;
  const { width, height } = resolveElementSize(container);

  let chartHost = shell.querySelector?.(":scope > [data-stat-echarts-host]");
  if (!chartHost) {
    if (!shell.style.position || shell.style.position === "static") {
      shell.style.position = "relative";
    }
    chartHost = document.createElement("div");
    chartHost.setAttribute("data-stat-echarts-host", "1");
    chartHost.style.position = "absolute";
    chartHost.style.left = "0";
    chartHost.style.top = "0";
    shell.appendChild(chartHost);
  }

  let chart =
    typeof echartsModule.getInstanceByDom === "function"
      ? echartsModule.getInstanceByDom(chartHost)
      : null;
  if (!chart) {
    chart = echartsModule.init(chartHost);
  }
  chart.setOption(option && typeof option === "object" ? option : {}, true);
  applyChartDimensions(chart, chartHost, width, height);
  ensureChartResizeObserver(shell, chart, chartHost, container);
  return chart;
}

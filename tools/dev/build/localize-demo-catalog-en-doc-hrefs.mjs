/**
 * Rewrite demo-catalog.en.json docLinks.href to doc/en/*.md where mirrors exist.
 * Usage: node tools/dev/build/localize-demo-catalog-en-doc-hrefs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const CATALOG_PATH = path.join(ROOT, "examples/html-demo/demo-catalog.en.json");

/** Basenames under doc/ that have doc/en/{basename}. */
const DOC_EN_MIRROR = new Set([
  "README.md",
  "api.md",
  "demos.md",
  "design-principles.md",
  "development.md",
  "domains.md",
  "extensions.md",
  "glossary.md",
  "info-panels.md",
  "json-format.md",
  "quick-start.md",
  "runtime-object-mutation-quickref.md",
  "scope.md",
  "tools.md",
  "tutorial.md"
]);

/** json-format.md: Chinese catalog anchor -> English heading slug. */
const JSON_FORMAT_ANCHOR_EN = {
  "人类友好-json": "friendly-json",
  friendlymap: "friendlymap",
  "标准-json": "standard-json",
  "objectlist-分发规则": "objectlist-dispatch-rules",
  "objtype-native通用-threejs-对象": "objtype-native-general-threejs-object",
  "objtype-controls视口控制器": "objtype-controls-viewport-controller",
  "sceneconfighelpersgrid--axes-辅助线": "sceneconfighelpers-grid--axes-helpers",
  "sceneconfigscenebackground-与-environment": "sceneconfigscene-background-and-environment",
  "预设-objtypewallglass-等": "preset-objtype-wall-glass-etc",
  "plane贴图纯色平面": "plane-textured--solid-plane",
  "shapeplane--irregularplane不规则平面": "shapeplane--irregularplane-irregular-plane",
  "shapeextrude--irregulargeometry不规则几何体": "shapeextrude--irregulargeometry-irregular-solid",
  "line-拓扑-topology": "line-topology-topology",
  "point点云-粒子": "points-point-cloud--particles",
  "particleemitter统一粒子发射器": "particleemitter-unified-emitter-entry",
  "domain-weather天气粒子预设": "domain-weather-weather-particle-presets",
  "shadersurfacecore-通用-shader-面": "shadersurface-core-generic-shader-surface",
  "sprite图标-标记": "sprite-icon--marker",
  "tube管道路径": "tube-pipe-path",
  "instanced显式-instancedmesh": "instanced-explicit-instancedmesh",
  audio: "audio",
  externalmodel: "externalmodel",
  "运行时对象查询": "runtime-object-lookup",
  "声明式动画-animations": "declarative-animations",
  "animationmode-可选": "animationmode-optional",
  "animationgraph可选gltf-动画状态机": "animationgraph-optional-gltf-animation-state-machine",
  "盒子-box": "box",
  "球体-sphere": "sphere",
  "其他基础几何体-primitive": "other-basic-primitives",
  "组合-group": "group",
  "线条-line": "line",
  "信息面板-infopanel": "infopanel",
  "可交互-css3d-面板-css3dpanelcore": "interactive-css3d-panel-css3dpanel-core",
  "热力图-heatmap": "heatmap",
  "动态平面-wind": "wind-dynamic-plane",
  "外部模型-objgltfglbthreejson": "external-models-objgltfglbthreejson",
  "obj-同目录-maps-回退": "obj-sibling-maps-fallback",
  "csg合并相交挖洞": "csg-union-intersection-holes",
  "纹理采样-texturequality": "assetlibrary-and-lib-texture-references",
  "world-业务场景-json扩展": "friendly-json"
};

const API_ANCHOR_EN = {
  "disposebythreejsonidscene-threejsonid-options--detachbythreejsonid":
    "disposebythreejsonidscene-threejsonid-options--detachbythreejsonid",
  coreutiltexturesamplingjs: "coreutiltextureutilsjs"
};

function resolveDocHrefToEn(href) {
  if (typeof href !== "string" || !href.startsWith("./doc/")) {
    return href;
  }
  const hashIdx = href.indexOf("#");
  const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const hash = hashIdx >= 0 ? href.slice(hashIdx + 1) : "";

  const docMatch = pathPart.match(/^\.\/doc\/([^/]+\.md)$/);
  if (!docMatch) {
    return href;
  }
  const basename = docMatch[1];
  if (!DOC_EN_MIRROR.has(basename)) {
    return href;
  }

  let enHash = hash;
  if (hash && basename === "json-format.md") {
    enHash = JSON_FORMAT_ANCHOR_EN[hash] ?? hash;
  } else if (hash && basename === "api.md") {
    enHash = API_ANCHOR_EN[hash] ?? hash;
  }

  const enPath = `./doc/en/${basename}`;
  return enHash ? `${enPath}#${enHash}` : enPath;
}

function localizeDocLinks(entry) {
  if (Array.isArray(entry.docLinks)) {
    for (const link of entry.docLinks) {
      if (link?.href) {
        link.href = resolveDocHrefToEn(link.href);
      }
    }
  }
  for (const step of entry.steps ?? []) {
    localizeDocLinks(step);
  }
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
if (!Array.isArray(catalog)) {
  throw new Error("demo-catalog.en.json must be an array");
}
for (const entry of catalog) {
  localizeDocLinks(entry);
}
fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n");
console.log("Updated docLinks.href in demo-catalog.en.json");

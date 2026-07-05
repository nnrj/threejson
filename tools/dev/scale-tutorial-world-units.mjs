/**
 * One-off: scale tutorial JSON world-space numbers by factor (default 0.1).
 * Skips whitelist files and non-world keys (DOM pixels, typography, fov, etc.).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TUTORIAL_ROOT = path.resolve(__dirname, "../../assets/json/tutorial");

const WHITELIST = new Set([
  "02-05-scene-background.json",
  "02-01-heatmap-wind.json",
  "02-09-particle-emitter-gpu.json",
  "02-10-particle-nebula-provider.json",
  "04-03-fps-walk.json",
  "04-04-fps-player-rig.json",
  "04-05-fps-rapier-collision.json",
  "04-08-info-panel-gallery.json"
]);

const NEVER_KEYS = new Set([
  "fov",
  "near",
  "intensity",
  "opacity",
  "ratioRate",
  "dampingFactor",
  "linewidth",
  "borderRadius",
  "fontSizePx",
  "padding",
  "lineHeight",
  "minFontPx",
  "maxFontPx",
  "fitRatio",
  "contentScale",
  "contentScaleX",
  "contentScaleY",
  "textureScale",
  "textureWidth",
  "textureHeight",
  "canvasWidth",
  "canvasHeight",
  "playbackRate",
  "speed",
  "waveSpeed",
  "waveHeight",
  "mirrorResolution",
  "widthSegments",
  "heightSegments",
  "radiusSegments",
  "segments",
  "metalness",
  "roughness",
  "dpr",
  "devicePixelRatio",
  "maxSteps",
  "debounce",
  "lowFps",
  "fps"
]);

const SCALE_KEYS = new Set([
  "x",
  "y",
  "z",
  "width",
  "height",
  "depth",
  "panelWidth",
  "panelHeight",
  "panelDepth",
  "topDistance",
  "far"
]);

function scaleValue(key, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return value;
  }
  const scaled = value * 0.1;
  if (key === "far") {
    return Math.max(100, Math.round(scaled));
  }
  if (key === "x" || key === "y" || key === "z") {
    return Math.round(scaled);
  }
  if (scaled === 0) {
    return 0;
  }
  const rounded = Math.round(scaled);
  if (rounded === 0 && value !== 0) {
    return value > 0 ? 1 : -1;
  }
  return rounded;
}

function isCss3dDomSizeKey(key, ancestors, self) {
  if (key !== "width" && key !== "height") {
    return false;
  }
  const chain = self ? [...ancestors, self] : ancestors;
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i];
    if (!node || typeof node !== "object") {
      continue;
    }
    const ot = String(node.objType ?? "").toLowerCase();
    if (ot === "css3dpanel") {
      return true;
    }
    if (node.content && (node.width !== undefined || node.height !== undefined)) {
      return true;
    }
  }
  return false;
}

function walk(node, ancestors, onScale) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walk(node[i], ancestors, onScale);
    }
    return;
  }
  const nextAncestors = [...ancestors, node];
  for (const [key, value] of Object.entries(node)) {
    if (NEVER_KEYS.has(key)) {
      continue;
    }
    if (typeof value === "number" && SCALE_KEYS.has(key)) {
      if (isCss3dDomSizeKey(key, ancestors, node)) {
        continue;
      }
      const scaled = scaleValue(key, value);
      if (scaled !== value) {
        node[key] = scaled;
        onScale?.({ key, from: value, to: scaled });
      }
      continue;
    }
    if (typeof value === "object" && value !== null) {
      walk(value, nextAncestors, onScale);
    }
  }
}

function collectJsonFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...collectJsonFiles(full));
    } else if (ent.name.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}

let changedFiles = 0;
for (const file of collectJsonFiles(TUTORIAL_ROOT)) {
  const base = path.basename(file);
  if (WHITELIST.has(base)) {
    console.log(`skip ${base}`);
    continue;
  }
  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw);
  let changes = 0;
  walk(data, [], () => {
    changes++;
  });
  if (changes > 0) {
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(`scaled ${base} (${changes} fields)`);
    changedFiles++;
  }
}
console.log(`done: ${changedFiles} files updated`);

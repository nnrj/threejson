import { registerSceneCapability } from "../../capabilities/sceneCapabilityManifest.js";
import { registerParticleSourceSampler } from "./particleSourceSampler.js";

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas;
  }
  throw new Error("[particles-raster] Canvas is unavailable in this host");
}

function samplePixels(imageData, count, source, random) {
  const candidates = [];
  const threshold = Math.max(0, Math.min(255, Number(source.alphaThreshold ?? 32)));
  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      if (imageData.data[(y * imageData.width + x) * 4 + 3] >= threshold) candidates.push([x, y]);
    }
  }
  if (!candidates.length) throw new Error("[particles-raster] mask contains no visible pixels");
  const width = Number(source.width ?? imageData.width) || imageData.width;
  const height = Number(source.height ?? imageData.height) || imageData.height;
  const depth = Math.max(0, Number(source.depth ?? 0) || 0);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const [x, y] = candidates[Math.floor(random() * candidates.length)];
    out[i * 3] = ((x + random()) / imageData.width - 0.5) * width;
    out[i * 3 + 1] = (0.5 - (y + random()) / imageData.height) * height;
    out[i * 3 + 2] = (random() - 0.5) * depth;
  }
  return out;
}

function textMaskSampler(source, count, options) {
  const resolution = Math.max(16, Math.floor(Number(source.resolution ?? 256) || 256));
  const canvas = createCanvas(resolution, resolution);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("[particles-raster] 2D context is unavailable");
  context.clearRect(0, 0, resolution, resolution);
  context.fillStyle = "white";
  context.textAlign = source.textAlign || "center";
  context.textBaseline = source.textBaseline || "middle";
  context.font = source.font || `${Math.floor(resolution * 0.55)}px sans-serif`;
  context.fillText(String(source.text ?? "ThreeJSON"), resolution / 2, resolution / 2, resolution * 0.95);
  return samplePixels(context.getImageData(0, 0, resolution, resolution), count, source, options.random);
}

async function loadImageData(source) {
  if (source.imageData?.data && source.imageData.width && source.imageData.height) return source.imageData;
  const url = typeof source.url === "string" ? source.url.trim() : "";
  if (!url) throw new Error("[particles-raster] imageMask requires url or ImageData");
  const response = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error(`[particles-raster] image request failed: HTTP ${response.status}`);
  const blob = await response.blob();
  if (typeof createImageBitmap !== "function") throw new Error("[particles-raster] createImageBitmap is unavailable");
  const bitmap = await createImageBitmap(blob);
  const canvas = createCanvas(bitmap.width, bitmap.height); const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0); bitmap.close?.();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

async function imageMaskSampler(source, count, options) {
  return samplePixels(await loadImageData(source), count, source, options.random);
}

let registered = false;
export function ensureParticlesRasterRegistered() {
  if (registered) return;
  registerParticleSourceSampler("textmask", textMaskSampler);
  registerParticleSourceSampler("imagemask", imageMaskSampler);
  for (const id of ["textMask", "imageMask"]) {
    registerSceneCapability("particleSources", id, { status: "stable", entry: "threejson/particles-raster", browser: true });
  }
  registered = true;
}

ensureParticlesRasterRegistered();


/**
 * `textureKind: "gif"`: gifuct-js decode + CanvasTexture, rAF-driven needsUpdate.
 * The browser must resolve bare specifier `gifuct-js` via import map (aligned with package.json dependency version).
 */
import * as THREE from "three";
import { log } from "./logger.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { applyUiTextureSampling } from "./textureSampling.js";

/**
 * @param {number|undefined} delayMs
 * @param {number} playbackRate
 * @param {number|undefined} maxFps
 */
function effectiveFrameDelayMs(delayMs, playbackRate, maxFps) {
    const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    let base = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 100;
    base = Math.max(1, base / rate);
    if (Number.isFinite(maxFps) && maxFps > 0) {
        base = Math.max(base, 1000 / maxFps);
    }
    return base;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {object[]} frames decompressFrames(..., true)
 * @param {number} frameIndex
 * @param {{ imageData: ImageData|null }} restoreRef Used by disposalType 3 (single-layer buffer)
 */
function compositeGifFrame(ctx, w, h, frames, frameIndex, restoreRef) {
    if (frameIndex > 0) {
        const prev = frames[frameIndex - 1];
        const disp = prev.disposalType === undefined || prev.disposalType === null ? 1 : prev.disposalType;
        if (disp === 2) {
            const d = prev.dims;
            ctx.clearRect(d.left, d.top, d.width, d.height);
        } else if (disp === 3 && restoreRef.imageData) {
            ctx.putImageData(restoreRef.imageData, 0, 0);
            restoreRef.imageData = null;
        }
    } else {
        ctx.clearRect(0, 0, w, h);
    }
    const cur = frames[frameIndex];
    const dispCur = cur.disposalType === undefined || cur.disposalType === null ? 1 : cur.disposalType;
    if (dispCur === 3) {
        restoreRef.imageData = ctx.getImageData(0, 0, w, h);
    }
    const d = cur.dims;
    const patch = cur.patch;
    if (!patch || !d || !Number.isFinite(d.width) || !Number.isFinite(d.height)) {
        return;
    }
    ctx.putImageData(new ImageData(patch, d.width, d.height), d.left, d.top);
}

/**
 * Similar to `createVideoTextureFromMaterialJson`: synchronous placeholder `CanvasTexture`, async decode then animation.
 * Does not write to the material POJO.
 *
 * @param {object} materialJson Material JSON (read-only repeat/playback config)
 * @param {string} url GIF URL
 * @param {{ wrapRepeat?: boolean, defaultRepeatX?: number, defaultRepeatY?: number }} [opts]
 * @returns {THREE.CanvasTexture}
 */
export function createGifCanvasTextureFromMaterialJson(materialJson, url, opts = {}) {
    const wrapRepeat = opts.wrapRepeat !== false;
    const defX = Number.isFinite(opts.defaultRepeatX) ? opts.defaultRepeatX : 1;
    const defY = Number.isFinite(opts.defaultRepeatY) ? opts.defaultRepeatY : 1;

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const texture = new THREE.CanvasTexture(canvas);
    applyUiTextureSampling(texture, materialJson);
    texture.wrapS = wrapRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.wrapT = wrapRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    const tr = materialJson.textureRepeat || {};
    texture.repeat.set(
        wrapRepeat ? (Number.isFinite(Number(tr.x)) ? Number(tr.x) : defX) : 1,
        wrapRepeat ? (Number.isFinite(Number(tr.y)) ? Number(tr.y) : defY) : 1
    );
    trackDisposableResource(texture);

    const playbackRate = Number.isFinite(Number(materialJson.gifPlaybackRate))
        ? Number(materialJson.gifPlaybackRate)
        : 1;
    const maxFps = Number.isFinite(Number(materialJson.gifMaxFps)) ? Number(materialJson.gifMaxFps) : undefined;
    const autoplay = materialJson.gifAutoplay !== false;

    let rafId = 0;
    let stopped = false;

    const stop = () => {
        stopped = true;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
    };

    const innerDispose = texture.dispose.bind(texture);
    texture.dispose = function disposeGifBackedTexture() {
        stop();
        innerDispose();
    };

    (async () => {
        try {
            const { parseGIF, decompressFrames } = await import("gifuct-js");
            const res = await fetch(url, { mode: "cors", credentials: "omit" });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const buffer = await res.arrayBuffer();
            const gif = parseGIF(buffer);
            const frames = decompressFrames(gif, true);
            if (!frames.length) {
                throw new Error("GIF has no frames");
            }
            const w = gif.lsd.width;
            const h = gif.lsd.height;
            canvas.width = w;
            canvas.height = h;
            texture.needsUpdate = true;

            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) {
                throw new Error("Canvas 2D context unavailable");
            }

            const restoreRef = { imageData: null };
            let frameIndex = 0;
            compositeGifFrame(ctx, w, h, frames, frameIndex, restoreRef);
            texture.needsUpdate = true;

            if (!autoplay || frames.length < 2) {
                return;
            }

            let lastSwitch = performance.now();
            let delayMs = effectiveFrameDelayMs(frames[0].delay, playbackRate, maxFps);

            const tick = (now) => {
                if (stopped) {
                    return;
                }
                if (now - lastSwitch >= delayMs) {
                    frameIndex = (frameIndex + 1) % frames.length;
                    compositeGifFrame(ctx, w, h, frames, frameIndex, restoreRef);
                    texture.needsUpdate = true;
                    lastSwitch = now;
                    delayMs = effectiveFrameDelayMs(frames[frameIndex].delay, playbackRate, maxFps);
                }
                rafId = requestAnimationFrame(tick);
            };
            rafId = requestAnimationFrame(tick);
        } catch (err) {
            log.error("[textureKind:gif] decode/load failed:", url, err);
        }
    })();
    return texture;
}

/** @deprecated Use {@link createGifCanvasTextureFromMaterialJson} and bind to THREE.Material.map */
export function attachGifCanvasTextureFromMaterialJson(material, url, opts = {}) {
    const texture = createGifCanvasTextureFromMaterialJson(material, url, opts);
    material.map = texture;
}

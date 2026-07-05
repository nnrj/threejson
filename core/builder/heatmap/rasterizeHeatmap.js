/**
 * DOM-free heatmap rasterization: Float32 intensity field + colormap LUT → RGBA buffer.
 * Generate texture from Gaussian splat scalar field + LUT (2D is volume with texDepth=1).
 * Used by heatmapTexture.js to build DataTexture / Data3DTexture.
 */

/** @typedef {{ t: number, color: string }} ColorStop Colormap control point: t is 0~1 position, color is #rrggbb, etc. */

/** Legacy JSON compat: flat heatmap default colormap (light zero; do not use for volume raymarch — see HEATMAP_LEGACY_COLOR_STOPS_VOLUME). */
export const HEATMAP_LEGACY_COLOR_STOPS = [
    { t: 0.0, color: '#fff' },
    { t: 0.3, color: '#0349df' },
    { t: 0.6, color: '#33f900' },
    { t: 0.8, color: '#e2fa00' },
    { t: 1.0, color: '#f00' }
];

/** Volume heatmap default colormap: zero must be dark; heatmapVolumeMaterial uses dens=max(rgb), #fff makes empty volume opaque. */
export const HEATMAP_LEGACY_COLOR_STOPS_VOLUME = [
    { t: 0.0, color: '#000000' },
    { t: 0.3, color: '#0349df' },
    { t: 0.6, color: '#33f900' },
    { t: 0.8, color: '#e2fa00' },
    { t: 1.0, color: '#f00' }
];

/** Max single-axis volume texture resolution (memory control). */
export const HEATMAP_VOLUME_MAX_TEX_AXIS = 160;

/**
 * Max voxels allowed for 3D volume heatmap (RGBA ~4× bytes).
 * Large planes like Port at 2048×1280×160 create ~4.2×10⁸ voxels blocking the main thread.
 */
export const HEATMAP_VOLUME_MAX_VOXELS = 32 * 1024 * 1024;

function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}

/**
 * Scale down width/height/depth proportionally so w×h×d ≤ maxVoxels.
 * @param {number} wi
 * @param {number} hi
 * @param {number} di
 * @param {number} [maxVoxels=HEATMAP_VOLUME_MAX_VOXELS]
 * @returns {{ width: number, height: number, depth: number }}
 */
export function clampVolumeTextureDims(wi, hi, di, maxVoxels = HEATMAP_VOLUME_MAX_VOXELS) {
    let w = clamp(Math.floor(wi), 2, 2048);
    let h = clamp(Math.floor(hi), 2, 2048);
    let d = clamp(Math.floor(di), 2, HEATMAP_VOLUME_MAX_TEX_AXIS);
    const prod = w * h * d;
    if (prod <= maxVoxels) {
        return { width: w, height: h, depth: d };
    }
    const ratio = Math.cbrt(maxVoxels / prod);
    w = Math.max(24, Math.floor(w * ratio));
    h = Math.max(24, Math.floor(h * ratio));
    d = Math.max(16, Math.floor(d * ratio));
    let p = w * h * d;
    while (p > maxVoxels && (w > 16 || h > 16 || d > 12)) {
        if (w >= h && w >= d) {
            w--;
        } else if (h >= d) {
            h--;
        } else {
            d--;
        }
        p = w * h * d;
    }
    return { width: Math.max(2, w), height: Math.max(2, h), depth: Math.max(2, d) };
}

/**
 * Volume grid cap on texel σ to avoid single splat approximating entire volume.
 */
function clampGaussianSigmaForVolumeTexels(sigma, tw, th, td) {
    if (sigma <= 0 || td <= 1) {
        return sigma;
    }
    const md = Math.min(tw, th, td);
    const cap = Math.max(10, Math.min(72, md * 0.28));
    return Math.min(sigma, cap);
}

function hexToRgb(hex) {
    let h = String(hex).replace('#', '').trim();
    if (h.length === 3) {
        h = h.split('').map((c) => c + c).join('');
    }
    const n = parseInt(h, 16);
    if (Number.isNaN(n) || h.length !== 6) {
        return [255, 255, 255];
    }
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** @param {ColorStop[]} stops Control points (sorted by t internally) */
function parseStops(stops) {
    const arr = stops.map((s) => ({ t: clamp(Number(s.t), 0, 1), color: s.color }));
    arr.sort((a, b) => a.t - b.t);
    return arr;
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * @param {ColorStop[] | Record<string, string>} stops Array form {t,color} or legacy Record (keys 0~1)
 * @param {number} [size=256] LUT entry count
 * @returns {Uint8Array} size×4 RGBA, 4 bytes per entry
 */
export function buildColormapLut(stops, size = 256) {
    let list;
    if (stops && !Array.isArray(stops)) {
        list = Object.keys(stops)
            .map((k) => ({ t: clamp(Number(k), 0, 1), color: stops[k] }))
            .sort((a, b) => a.t - b.t);
    } else {
        list = parseStops(/** @type {ColorStop[]} */ (stops));
    }
    if (!list.length) {
        list = [{ t: 0, color: '#000' }, { t: 1, color: '#fff' }];
    }
    const lut = new Uint8Array(size * 4);
    const rgbAt = (t) => {
        const x = clamp(t, 0, 1);
        let a = list[0];
        let b = list[list.length - 1];
        for (let i = 0; i < list.length - 1; i++) {
            if (x >= list[i].t && x <= list[i + 1].t) {
                a = list[i];
                b = list[i + 1];
                break;
            }
            if (x < list[i + 1].t) {
                a = list[i];
                b = list[i + 1];
                break;
            }
        }
        if (b.t <= a.t) {
            return hexToRgb(a.color);
        }
        const u = (x - a.t) / (b.t - a.t);
        const [r0, g0, b0] = hexToRgb(a.color);
        const [r1, g1, b1] = hexToRgb(b.color);
        return [
            Math.round(lerp(r0, r1, u)),
            Math.round(lerp(g0, g1, u)),
            Math.round(lerp(b0, b1, u))
        ];
    };
    for (let i = 0; i < size; i++) {
        const t = size <= 1 ? 0 : i / (size - 1);
        const [r, g, b] = rgbAt(t);
        const o = i * 4;
        lut[o] = r;
        lut[o + 1] = g;
        lut[o + 2] = b;
        lut[o + 3] = 255;
    }
    return lut;
}

/**
 * Map plane coordinates to texture pixel center (texel).
 * @param {number} x
 * @param {number} y
 * @param {'pixel' | 'normalized'} mode pixel: same units as plane width/height; normalized: 0~1
 * @param {number} planeW Plane width (world or pixel logical width, matches JSON)
 * @param {number} planeH Plane height
 * @param {number} texW Texture width (pixels)
 * @param {number} texH Texture height
 * @returns {{ u: number, v: number }} Texture-space center coordinates
 */
export function pointToTexel(x, y, mode, planeW, planeH, texW, texH) {
    let u;
    let v;
    if (mode === 'normalized') {
        u = clamp(x, 0, 1) * (texW - 1);
        v = clamp(y, 0, 1) * (texH - 1);
    } else {
        const px = clamp(x, 0, planeW);
        const py = clamp(y, 0, planeH);
        u = planeW > 0 ? (px / planeW) * (texW - 1) : 0;
        v = planeH > 0 ? (py / planeH) * (texH - 1) : 0;
    }
    return { u, v };
}

/**
 * Map (x,y,z) to voxel center; w=0 when texDepth<=1.
 */
export function pointToTexel3(x, y, z, mode, planeW, planeH, planeD, texW, texH, texD) {
    const { u, v } = pointToTexel(x, y, mode, planeW, planeH, texW, texH);
    const znum = z !== undefined && z !== null && Number.isFinite(Number(z)) ? Number(z) : 0;
    let w = 0;
    if (texD > 1) {
        if (mode === 'normalized') {
            w = clamp(znum, 0, 1) * (texD - 1);
        } else {
            const pz = clamp(znum, 0, planeD);
            w = planeD > 0 ? (pz / planeD) * (texD - 1) : 0;
        }
    }
    return { u, v, w };
}

function normalizeValue(val, vmin, vmax) {
    if (vmax <= vmin) {
        return 0;
    }
    return clamp((val - vmin) / (vmax - vmin), 0, 1);
}

function pointScalar(p, valueKey) {
    const raw =
        p[valueKey] !== undefined && p[valueKey] !== null
            ? p[valueKey]
            : p.value !== undefined && p.value !== null
              ? p.value
              : p.temperature;
    return Number(raw);
}

function pointZ(p) {
    if (p.z !== undefined && p.z !== null && Number.isFinite(Number(p.z))) {
        return Number(p.z);
    }
    return 0;
}

/**
 * Add one 2D Gaussian splat on Float32 intensity field.
 * @param {Float32Array} field Row-major grid of length texW×texH
 * @param {'add' | 'max'} composition Multi-source composition: add or max
 */
export function gaussianSplat(field, texW, texH, cx, cy, weight, sigmaPx, composition) {
    gaussianSplat3(field, texW, texH, 1, cx, cy, 0, weight, sigmaPx, composition);
}

/**
 * Add one isotropic Gaussian splat on 3D Float32 volume (x fastest, z slowest: idx = x + tw*(y + th*z)).
 */
export function gaussianSplat3(field, texW, texH, texD, cx, cy, cz, weight, sigmaPx, composition) {
    if (weight <= 0 || sigmaPx <= 0 || texD < 1) {
        return;
    }
    const sigma = sigmaPx;
    const inv2s2 = 1 / (2 * sigma * sigma);
    const r = Math.ceil(3 * sigma);
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(texW - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(texH - 1, Math.ceil(cy + r));
    const z0 = texD <= 1 ? 0 : Math.max(0, Math.floor(cz - r));
    const z1 = texD <= 1 ? 0 : Math.min(texD - 1, Math.ceil(cz + r));
    for (let z = z0; z <= z1; z++) {
        const dz = z - cz;
        const dz2 = dz * dz;
        for (let y = y0; y <= y1; y++) {
            const dy = y - cy;
            const dy2 = dy * dy;
            const row = (z * texH + y) * texW;
            for (let x = x0; x <= x1; x++) {
                const dx = x - cx;
                const d2 = dx * dx + dy2 + dz2;
                const g = weight * Math.exp(-d2 * inv2s2);
                const idx = row + x;
                if (composition === 'max') {
                    field[idx] = Math.max(field[idx], g);
                } else {
                    field[idx] += g;
                }
            }
        }
    }
}

function fieldMax(field) {
    let m = 0;
    for (let i = 0; i < field.length; i++) {
        if (field[i] > m) {
            m = field[i];
        }
    }
    return m;
}

/**
 * 3D volume heatmap grid → RGBA (WebGL TEXTURE_3D order: texel increments x→y→z).
 * @param {object} opts
 * @returns {{ rgba: Uint8Array, intensity: Float32Array }}
 */
export function rasterizeHeatmapVolumeRgba(opts) {
    const {
        texWidth: twIn,
        texHeight: thIn,
        texDepth: tdIn,
        planeWidth: pw,
        planeHeight: ph,
        planeDepth: pd,
        points,
        valueKey = 'value',
        coordinateMode = 'pixel',
        valueRange,
        composition = 'add',
        sigmaPixels,
        sigmaScaleWithValue = false,
        sigmaBasePixels = 200 / 2.5,
        lut: lutIn,
        colormapStops,
        normalizeField = true
    } = opts;

    const tw = Math.max(1, Math.floor(twIn));
    const th = Math.max(1, Math.floor(thIn));
    const td = Math.max(1, Math.floor(tdIn));
    const planeD = Number(pd) > 0 ? Number(pd) : 1;

    const n = tw * th * td;
    const field = new Float32Array(n);
    const vmin = valueRange.min;
    const vmax = valueRange.max;

    const defaultStops = td <= 1 ? HEATMAP_LEGACY_COLOR_STOPS : HEATMAP_LEGACY_COLOR_STOPS_VOLUME;
    const lut = lutIn || buildColormapLut(colormapStops || defaultStops, 256);

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const val = pointScalar(p, valueKey);
        if (!Number.isFinite(val)) {
            continue;
        }
        const vn = normalizeValue(val, vmin, vmax);
        const { u, v, w } = pointToTexel3(
            p.x,
            p.y,
            pointZ(p),
            coordinateMode,
            pw,
            ph,
            planeD,
            tw,
            th,
            td
        );

        let sigma;
        if (sigmaPixels != null && !sigmaScaleWithValue) {
            sigma = Math.max(0.5, sigmaPixels);
        } else {
            const base = sigmaBasePixels;
            sigma = Math.max(0.5, base * (sigmaScaleWithValue ? vn || 0.01 : 1));
        }
        sigma = clampGaussianSigmaForVolumeTexels(sigma, tw, th, td);
        const weight = vn;
        gaussianSplat3(field, tw, th, td, u, v, w, weight, sigma, composition);
    }

    const rgba = new Uint8Array(n * 4);
    const imax = normalizeField ? fieldMax(field) : 1;
    const scale = imax > 0 && normalizeField ? 1 / imax : 1;

    for (let i = 0; i < n; i++) {
        let t = field[i] * scale;
        t = clamp(t, 0, 1);
        const li = Math.min(255, Math.floor(t * 255.999));
        const lo = li * 4;
        const o = i * 4;
        rgba[o] = lut[lo];
        rgba[o + 1] = lut[lo + 1];
        rgba[o + 2] = lut[lo + 2];
        rgba[o + 3] = lut[lo + 3];
    }

    return { rgba, intensity: field };
}

/**
 * Rasterize heatmap from sample points and output RGBA (equivalent to volume with texDepth=1).
 * @param {object} opts Options (texWidth/texHeight, planeWidth/planeHeight, points, valueRange, etc.)
 * @returns {{ rgba: Uint8Array, intensity: Float32Array }} rgba is row-major RGBA; intensity is raw intensity field
 */
export function rasterizeHeatmapRgba(opts) {
    const {
        texWidth: tw,
        texHeight: th,
        planeWidth: pw,
        planeHeight: ph,
        points,
        valueKey = 'value',
        coordinateMode = 'pixel',
        valueRange,
        composition = 'add',
        sigmaPixels,
        sigmaScaleWithValue = false,
        sigmaBasePixels = 200 / 2.5,
        lut: lutIn,
        colormapStops,
        normalizeField = true
    } = opts;

    return rasterizeHeatmapVolumeRgba({
        texWidth: tw,
        texHeight: th,
        texDepth: 1,
        planeWidth: pw,
        planeHeight: ph,
        planeDepth: 1,
        points,
        valueKey,
        coordinateMode,
        valueRange,
        composition,
        sigmaPixels,
        sigmaScaleWithValue,
        sigmaBasePixels,
        lut: lutIn,
        colormapStops,
        normalizeField
    });
}

/**
 * Derive default texture resolution from plane width/height (decoupled from plane, clamped 256~2048).
 * @param {number} planeWidth
 * @param {number} planeHeight
 * @returns {{ width: number, height: number }}
 */
export function defaultTextureDimensions(planeWidth, planeHeight) {
    const w = Math.min(2048, Math.max(256, Math.round(Number(planeWidth) * 4)));
    const h = Math.min(2048, Math.max(256, Math.round(Number(planeHeight) * 4)));
    return { width: w, height: h };
}

/**
 * Volume heatmap default texture size: XY same as defaultTextureDimensions; Z from depth capped by HEATMAP_VOLUME_MAX_TEX_AXIS.
 * @param {number} planeWidth
 * @param {number} planeHeight
 * @param {number} planeDepth
 * @returns {{ width: number, height: number, depth: number }}
 */
export function defaultTextureDimensions3D(planeWidth, planeHeight, planeDepth) {
    const xy = defaultTextureDimensions(planeWidth, planeHeight);
    const pd = Math.max(1e-6, Number(planeDepth));
    let d = Math.min(HEATMAP_VOLUME_MAX_TEX_AXIS, Math.max(8, Math.round(pd * 4)));
    d = Math.min(d, HEATMAP_VOLUME_MAX_TEX_AXIS);
    return clampVolumeTextureDims(xy.width, xy.height, d);
}

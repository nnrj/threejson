/**
 * Three.js DataTexture and heatmap plane Mesh wrapper (includes resource tracking).
 * Generate texture from Gaussian splat scalar field + LUT.
 */
import { trackDisposableResource } from '../../handler/trackedResourceRegistry.js';
import { setUserDataObjJson } from '../../handler/objectDescriptorAttach.js';
import {
    buildColormapLut,
    clampVolumeTextureDims,
    defaultTextureDimensions,
    defaultTextureDimensions3D,
    rasterizeHeatmapVolumeRgba,
    rasterizeHeatmapRgba,
    HEATMAP_LEGACY_COLOR_STOPS,
    HEATMAP_LEGACY_COLOR_STOPS_VOLUME
} from './rasterizeHeatmap.js';
import { createHeatmapVolumeMaterial, updateHeatmapVolumeUniforms } from './heatmapVolumeMaterial.js';
import { applyVisibilityFromDescriptor } from '../../util/util.js';

function hasValue(value) {
    return value !== undefined && value !== null;
}

function normalizePosition(position = {}) {
    return {
        x: hasValue(position.x) ? position.x : 0,
        y: hasValue(position.y) ? position.y : 0,
        z: hasValue(position.z) ? position.z : 0
    };
}

function normalizeRotation(rotation = {}) {
    return {
        rotationX: hasValue(rotation.rotationX) ? rotation.rotationX : 0,
        rotationY: hasValue(rotation.rotationY) ? rotation.rotationY : 0,
        rotationZ: hasValue(rotation.rotationZ) ? rotation.rotationZ : 0
    };
}

function normalizeScale(scale = {}) {
    return {
        scaleX: hasValue(scale.scaleX) ? scale.scaleX : 1,
        scaleY: hasValue(scale.scaleY) ? scale.scaleY : 1,
        scaleZ: hasValue(scale.scaleZ) ? scale.scaleZ : 1
    };
}

/**
 * Apply position / rotation / scale to Object3D.
 * @param {import('three').Object3D} object3D
 * @param {object} [source={}] May include position, rotation, scale sub-objects
 */
function applyObjectTransform(object3D, source = {}) {
    const position = normalizePosition(source.position);
    const rotation = normalizeRotation(source.rotation);
    const scale = normalizeScale(source.scale);

    object3D.position.set(position.x, position.y, position.z);
    object3D.rotation.set(rotation.rotationX, rotation.rotationY, rotation.rotationZ);
    object3D.scale.set(scale.scaleX, scale.scaleY, scale.scaleZ);
}

/**
 * Infer value range from point set (fallback 0~1 with no valid points; expand range slightly when all equal to avoid divide-by-zero).
 * @param {Array<object>} points
 * @param {string} [valueKey='value']
 * @returns {{ min: number, max: number }}
 */
function inferValueRange(points, valueKey = 'value') {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const v = Number(
            hasValue(p[valueKey]) ? p[valueKey] : hasValue(p.value) ? p.value : p.temperature
        );
        if (!Number.isFinite(v)) {
            continue;
        }
        min = Math.min(min, v);
        max = Math.max(max, v);
    }
    if (!Number.isFinite(min)) {
        return { min: 0, max: 1 };
    }
    if (min === max) {
        return { min: min - 1, max: max + 1 };
    }
    return { min, max };
}

/**
 * Parse material side: supports 'double' or passed constant.
 * @param {typeof import('three')} THREE
 * @param {string|number|undefined} side
 * @returns {number} Three side enum
 */
function resolveSide(THREE, side) {
    if (side === 'double' || side === THREE.DoubleSide) {
        return THREE.DoubleSide;
    }
    return THREE.FrontSide;
}

/**
 * Build heatmap DataTexture from spec (RGBA, SRGB, linear interpolation).
 * @param {typeof import('three')} THREE
 * @param {object} spec
 * @param {{ width: number, height: number }} [spec.plane] Plane size; or planeWidth/planeHeight
 * @param {{ width: number, height: number }} [spec.textureSize] Texture pixel size; default from defaultTextureDimensions
 * @param {Array<{x:number,y:number,value?:number,temperature?:number}>} [spec.points] Sample points
 * @param {string} [spec.valueKey] Value field name, e.g. 'value' or 'temperature'
 * @param {{ min: number, max: number }} [spec.valueRange] Value mapping range; default inferred from points
 * @param {'pixel'|'normalized'} [spec.coordinateMode] Point coordinate meaning
 * @param {'add'|'max'} [spec.composition] Multi-source composition
 * @param {number} [spec.sigmaPixels] Fixed σ (pixels)
 * @param {boolean} [spec.sigmaScaleWithValue] Whether σ scales with normalized value
 * @param {number} [spec.sigmaBasePixels] Base pixels for σ scaling
 * @param {Array|Record<string,string>} [spec.colormapStops] Colormap
 * @param {Uint8Array} [spec.lut] Precomputed LUT (colormapStops alternative)
 * @returns {import('three').DataTexture}
 */
export function buildHeatmapTexture(THREE, spec) {
    const planeW = Number(spec.plane?.width ?? spec.planeWidth ?? 1);
    const planeH = Number(spec.plane?.height ?? spec.planeHeight ?? 1);
    const tex =
        spec.textureSize ||
        defaultTextureDimensions(planeW, planeH);
    const tw = Math.max(1, Math.floor(tex.width));
    const th = Math.max(1, Math.floor(tex.height));

    const points = spec.points || [];
    const valueKey = spec.valueKey || 'value';
    const valueRange = spec.valueRange
        ? {
              min: spec.valueRange.min,
              max: spec.valueRange.max
          }
        : inferValueRange(points, valueKey);

    const lut =
        spec.lut ||
        (spec.colormapStops
            ? buildColormapLut(spec.colormapStops, spec.lutSize || 256)
            : buildColormapLut(HEATMAP_LEGACY_COLOR_STOPS, spec.lutSize || 256));

    const { rgba } = rasterizeHeatmapRgba({
        texWidth: tw,
        texHeight: th,
        planeWidth: planeW,
        planeHeight: planeH,
        points,
        valueKey,
        coordinateMode: spec.coordinateMode || 'pixel',
        valueRange,
        composition: spec.composition || 'add',
        sigmaPixels: spec.sigmaPixels,
        sigmaScaleWithValue: spec.sigmaScaleWithValue ?? false,
        sigmaBasePixels: spec.sigmaBasePixels ?? 200 / 2.5,
        lut,
        normalizeField: spec.normalizeField !== false
    });

    const texture = new THREE.DataTexture(
        rgba,
        tw,
        th,
        THREE.RGBAFormat
    );
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    trackDisposableResource(texture);
    return texture;
}

/**
 * Build heatmap Data3DTexture from spec (RGBA).
 * @param {typeof import('three')} THREE
 * @param {object} spec
 * @param {{ width:number,height:number,depth:number }} [spec.volume] Volume size in world space; or planeWidth/planeDepth aliases
 */
export function buildHeatmapVolumeTexture(THREE, spec) {
    const volW = Number(spec.volume?.width ?? spec.plane?.width ?? spec.planeWidth ?? 1);
    const volH = Number(spec.volume?.height ?? spec.plane?.height ?? spec.planeHeight ?? 1);
    const volD = Number(spec.volume?.depth ?? spec.plane?.depth ?? spec.planeDepth ?? 1);

    const tex = spec.textureSize || defaultTextureDimensions3D(volW, volH, volD);
    const c = clampVolumeTextureDims(tex.width, tex.height, tex.depth);
    const tw = Math.max(1, Math.floor(c.width));
    const th = Math.max(1, Math.floor(c.height));
    const td = Math.max(2, Math.floor(c.depth));

    const points = spec.points || [];
    const valueKey = spec.valueKey || 'value';
    const valueRange = spec.valueRange
        ? {
              min: spec.valueRange.min,
              max: spec.valueRange.max
          }
        : inferValueRange(points, valueKey);

    const lut =
        spec.lut ||
        (spec.colormapStops
            ? buildColormapLut(spec.colormapStops, spec.lutSize || 256)
            : buildColormapLut(HEATMAP_LEGACY_COLOR_STOPS_VOLUME, spec.lutSize || 256));

    const vr = rasterizeHeatmapVolumeRgba({
        texWidth: tw,
        texHeight: th,
        texDepth: td,
        planeWidth: volW,
        planeHeight: volH,
        planeDepth: Math.max(volD, 1e-6),
        points,
        valueKey,
        coordinateMode: spec.coordinateMode || 'pixel',
        valueRange,
        composition: spec.composition || 'add',
        sigmaPixels: spec.sigmaPixels,
        sigmaScaleWithValue: spec.sigmaScaleWithValue ?? false,
        sigmaBasePixels: spec.sigmaBasePixels ?? 200 / 2.5,
        lut,
        normalizeField: spec.normalizeField !== false
    });

    const texture = new THREE.Data3DTexture(vr.rgba, tw, th, td);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    trackDisposableResource(texture);
    return texture;
}

/**
 * Volume heatmap Mesh (box + raymarch material). Uniforms updated via mesh.onBeforeRender before render (hooked by this function).
 * @param {typeof import('three')} THREE
 * @param {object} spec Includes volume/points/buildHeatmapVolumeTexture-like fields; optional volumeRender: {steps, alphaGain}
 * @returns {import('three').Mesh}
 */
export function createHeatmapVolumeMesh(THREE, spec) {
    const volW = Number(spec.volume?.width ?? spec.plane?.width ?? spec.planeWidth ?? 1);
    const volH = Number(spec.volume?.height ?? spec.plane?.height ?? spec.planeHeight ?? 1);
    const volD = Number(spec.volume?.depth ?? spec.plane?.depth ?? spec.planeDepth ?? 1);

    const map3d = buildHeatmapVolumeTexture(THREE, spec);
    const matOpts = spec.material || {};
    const vr = spec.volumeRender || {};

    const material = createHeatmapVolumeMaterial(
        THREE,
        map3d,
        { width: volW, height: volH, depth: volD },
        {
            steps: vr.steps ?? 96,
            alphaGain: vr.alphaGain != null ? vr.alphaGain : 1,
            opacity: hasValue(matOpts.opacity) ? matOpts.opacity : 1,
            side: THREE.DoubleSide,
            depthWrite: matOpts.depthWrite === true,
            transparent: matOpts.transparent !== false
        }
    );
    trackDisposableResource(material);

    const geometry = new THREE.BoxGeometry(volW, volH, volD);
    trackDisposableResource(geometry);

    const mesh = new THREE.Mesh(geometry, material);
    trackDisposableResource(mesh);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;

    mesh.onBeforeRender = (_, __, camera) => {
        updateHeatmapVolumeUniforms(material, mesh, camera);
    };

    if (spec.transform) {
        applyObjectTransform(mesh, spec.transform);
    } else {
        applyObjectTransform(mesh, {
            position: spec.position,
            rotation: spec.rotation,
            scale: spec.scale
        });
    }

    if (spec.userData != null && typeof spec.userData === "object" && !Array.isArray(spec.userData)) {
        mesh.userData = { ...spec.userData };
    }
    if (spec.userDataObjJson != null) {
        setUserDataObjJson(mesh, spec.userDataObjJson);
        applyVisibilityFromDescriptor(mesh, spec.userDataObjJson);
    }

    return mesh;
}

/**
 * Create plane Mesh with heat texture (not auto-added to scene). Texture and material resource-tracked.
 * @param {typeof import('three')} THREE
 * @param {object} spec All buildHeatmapTexture fields, plus:
 * @param {object} [spec.geometrySegments] { width, height } plane segments; or spec.plane.widthSegments, etc.
 * @param {object} [spec.material] `{ transparent, opacity, side, depthWrite }`
 * @param {object} [spec.transform] position / rotation / scale; or top-level position, etc.
 * @param {object} [spec.userData] Assigned directly to mesh.userData
 * @param {object} [spec.userDataObjJson] Written to mesh.userData.objJson
 * @returns {import('three').Mesh}
 */
export function createHeatmapMesh(THREE, spec) {
    const planeW = Number(spec.plane?.width ?? spec.planeWidth ?? 1);
    const planeH = Number(spec.plane?.height ?? spec.planeHeight ?? 1);
    const segW = spec.geometrySegments?.width ?? spec.plane?.widthSegments ?? 1;
    const segH = spec.geometrySegments?.height ?? spec.plane?.heightSegments ?? 1;

    const texture = buildHeatmapTexture(THREE, spec);
    const matOpts = spec.material || {};
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: matOpts.transparent !== false,
        opacity: hasValue(matOpts.opacity) ? matOpts.opacity : 1,
        depthWrite: matOpts.depthWrite !== false,
        side: resolveSide(THREE, matOpts.side)
    });
    trackDisposableResource(material);

    const geometry = new THREE.PlaneGeometry(planeW, planeH, segW, segH);
    trackDisposableResource(geometry);

    const mesh = new THREE.Mesh(geometry, material);
    trackDisposableResource(mesh);

    if (spec.transform) {
        applyObjectTransform(mesh, spec.transform);
    } else {
        applyObjectTransform(mesh, {
            position: spec.position,
            rotation: spec.rotation,
            scale: spec.scale
        });
    }

    if (spec.userData != null && typeof spec.userData === "object" && !Array.isArray(spec.userData)) {
        mesh.userData = { ...spec.userData };
    }
    if (spec.userDataObjJson != null) {
        setUserDataObjJson(mesh, spec.userDataObjJson);
        applyVisibilityFromDescriptor(mesh, spec.userDataObjJson);
    }

    return mesh;
}

export {
    applyObjectTransform,
    buildColormapLut,
    defaultTextureDimensions,
    defaultTextureDimensions3D,
    HEATMAP_LEGACY_COLOR_STOPS,
    HEATMAP_LEGACY_COLOR_STOPS_VOLUME,
    rasterizeHeatmapVolumeRgba,
    rasterizeHeatmapRgba
};

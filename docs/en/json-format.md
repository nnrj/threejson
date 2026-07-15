[中文](../zh/json-format.md) | [English](./json-format.md)

# ThreeJSON JSON Format

ThreeJSON JSON is a declarative description of a Three.js scene. It contains:

- Runtime configuration: scene, camera, renderer, controls, lights, assets, events, and render loop.
- Scene objects: geometry, materials, models, domain objects, extension objects, panels, audio, and more.

ThreeJSON supports two equivalent authoring shapes:

- Standard JSON: centered on one heterogeneous `objectList`; recommended for program and AI generation, storage, and diffs.
- Friendly JSON: centered on typed lists under `worldInfo`; good for human-readable examples and hand editing.

During loading, friendly JSON is normalized into the standard object list. Export APIs can also convert between the two shapes.

## 1. Minimal Shape

```json
{
  "version": "next",
  "name": "hello-threejson",
  "sceneConfig": {
    "scene": { "background": "#11151b" },
    "camera": { "fov": 55, "near": 0.1, "far": 200, "position": { "x": 10, "y": 8, "z": 12 } },
    "controls": { "enableDamping": true, "target": { "x": 0, "y": 1.5, "z": 0 } },
    "lights": [{ "type": "ambient", "intensity": 1 }],
    "renderLoop": { "autoResize": true, "firstAutoResize": true }
  },
  "worldInfo": {
    "boxModelList": [
      {
        "threeJsonId": "box-1",
        "objType": "box",
        "geometry": { "width": 3, "height": 3, "depth": 3 },
        "position": { "x": 0, "y": 1.5, "z": 0 },
        "material": { "type": "standard", "color": "#5470c6" }
      }
    ]
  }
}
```

## 2. Top-Level Fields

| Field | Type | Description |
| --- | --- | --- |
| `version` | string | JSON version marker. Current examples commonly use `next`. |
| `threeJsonId` | string | Scene document ID, not an object ID. |
| `name` | string | Scene name. |
| `label` | string | Display label. |
| `sceneConfig` | object | Runtime configuration. |
| `worldInfo` | object | Friendly JSON typed lists and scene metadata. |
| `objectList` | array | Standard JSON object list. |
| `friendlyMap` | object | Custom friendly-list mapping rules. Advanced usage. |
| `subSceneList` | array | Sub-scene definitions. |
| `extensions` | object | Extension configuration. |

If `objectList` and `worldInfo` both exist and `objectList` is not empty, the loader treats `objectList` as the object source.

## 3. Standard JSON

Standard JSON puts runtime records and content records in `objectList`.

```json
{
  "version": "next",
  "objectList": [
    { "objType": "scene", "background": "#11151b" },
    { "objType": "camera", "fov": 55, "position": { "x": 10, "y": 8, "z": 12 } },
    { "objType": "light", "lightType": "ambient", "intensity": 1 },
    {
      "threeJsonId": "box-1",
      "objType": "box",
      "geometry": { "width": 3, "height": 3, "depth": 3 },
      "material": { "color": "#5470c6" }
    }
  ]
}
```

Common runtime `objType` values:

| `objType` | Description |
| --- | --- |
| `scene` | Scene backdrop, environment, fog, and related hints. |
| `camera` | Camera configuration. |
| `renderer` | Renderer configuration. |
| `controls` | Controls configuration. |
| `light` | Light record. |
| `renderLoop` | Render-loop configuration. |

## 4. Friendly JSON

Friendly JSON groups objects by typed lists under `worldInfo`.

```json
{
  "sceneConfig": {
    "scene": { "background": "#11151b" },
    "camera": { "position": { "x": 10, "y": 8, "z": 12 } }
  },
  "worldInfo": {
    "boxModelList": [],
    "sphereModelList": [],
    "lineList": [],
    "domainModelList": []
  }
}
```

Common lists:

| List | Typical `objType` | Description |
| --- | --- | --- |
| `boxModelList` | `box`, `cylinder`, `cone`, `ring`, `torus`, `capsule` | Basic primitives. |
| `sphereModelList` | `sphere` | Spheres. |
| `meshList` | `box`, `sphere` | Compatibility list for basic meshes. |
| `groupList` | `group` | Groups. |
| `lineList` | `line` | Lines and polylines. |
| `planeList` | `plane` | Planes. |
| `spriteList` | `sprite` | Sprites. |
| `particleList` | `points` or particle records | Points and particles. |
| `tubeList` | `tube` | Tubes and paths. |
| `instancedList` | `instanced` | Instanced objects. |
| `externalModelList` | `externalModel` | glTF, OBJ, FBX, and other external models. |
| `objModelList` | `externalModel` or OBJ-compatible records | OBJ compatibility list. |
| `domainModelList` | `domain` | Business-domain objects. |
| `infoPanelList` | `infoPanel` | 3D information panels. |
| `css3dPanelList` | `css3dPanel` | CSS3D panels. |
| `heatList` | `heatMap` | Heatmaps. |
| `windList` | `wind` | Wind fields. |
| `shaderSurfaceList` | `shaderSurface` | Shader surfaces. |
| `shapePlaneList` | `shapePlane` | Shape planes. |
| `shapeExtrudeList` | `shapeExtrude` | Extruded shapes. |
| `irregularPlaneList` | `irregularPlane` | Irregular planes. |
| `irregularGeometryList` | `irregularGeometry` | Irregular geometry. |
| `bufferMeshList` | `bufferMesh` | Explicit BufferGeometry. |
| `audioList` | `audio` | Scene audio. |
| `skinnedList` | `skinned` | Skinned models. |

## 5. `sceneConfig`

`sceneConfig` describes the runtime environment.

```json
{
  "sceneConfig": {
    "assetsBase": "/assets",
    "assetsBaseMode": "base-first",
    "scene": { "background": "#11151b" },
    "camera": { "fov": 55, "near": 0.1, "far": 200, "position": { "x": 10, "y": 8, "z": 12 } },
    "renderer": { "antialias": true, "ratioRate": 1 },
    "controls": { "enableDamping": true, "target": { "x": 0, "y": 1.5, "z": 0 } },
    "lights": [{ "type": "ambient", "color": "#ffffff", "intensity": 1 }],
    "renderLoop": { "autoResize": true, "firstAutoResize": true }
  }
}
```

### 5.1 Scene

| Field | Type | Description |
| --- | --- | --- |
| `scene.background` | string/object | Background. Use a color string such as `"#11151b"` or an object. |
| `scene.environment` | string/object | Environment map hints. |
| `scene.fog` | object | Fog configuration following Three.js semantics. |

Object form:

```json
{
  "scene": {
    "background": { "type": "color", "value": "#11151b" }
  }
}
```

### 5.2 Camera

| Field | Type | Description |
| --- | --- | --- |
| `type` | string | Camera type. Perspective is the default. |
| `fov` | number | Perspective field of view. |
| `near` / `far` | number | Clipping planes. |
| `position` | Vector3 | Camera position. |
| `target` | Vector3 | Control target. |
| `lookAt` | Vector3 | Look-at point. |
| `up` | Vector3 | Camera up vector. |

### 5.3 Renderer

| Field | Type | Description |
| --- | --- | --- |
| `antialias` | boolean | Enable antialiasing. |
| `alpha` | boolean | Enable transparent background. |
| `preserveDrawingBuffer` | boolean | Preserve drawing buffer, useful for screenshots. |
| `shadowMapEnabled` | boolean | Enable shadows. |
| `ratioRate` | number | Pixel-ratio multiplier. |
| `clearAlpha` | number | Clear alpha. |

### 5.4 Controls

| Field | Type | Description |
| --- | --- | --- |
| `type` | string | Controls type. Orbit-style controls are the default. |
| `enabled` | boolean | Enable controls. |
| `target` | Vector3 | Orbit/pan target. |
| `enableDamping` | boolean | Enable damping. |
| `dampingFactor` | number | Damping factor. |
| `enableZoom` / `enableRotate` / `enablePan` | boolean | Enable zoom, rotate, and pan. |
| `minDistance` / `maxDistance` | number | Distance limits. |

### 5.5 Lights

```json
[
  { "type": "ambient", "color": "#ffffff", "intensity": 0.8 },
  { "type": "directional", "color": "#ffffff", "intensity": 1.2, "position": { "x": 10, "y": 16, "z": 12 } },
  { "type": "point", "color": "#ffdd99", "intensity": 1200, "distance": 120, "position": { "x": 0, "y": 8, "z": 0 } }
]
```

| Field | Description |
| --- | --- |
| `type` | `ambient`, `directional`, `point`, and related light types. |
| `color` | Light color. |
| `intensity` | Light intensity. |
| `position` | Position for lights that need it. |
| `target` | Target for directional-style lights. |
| `distance` / `decay` | Point-light fields. |

### 5.6 Render Loop

| Field | Type | Description |
| --- | --- | --- |
| `autoStart` | boolean | Start automatically. |
| `autoResize` | boolean | React to container size changes. |
| `firstAutoResize` | boolean | Fit size immediately after load. |
| `enabled` | boolean | Enable the render loop. |

### 5.7 Assets

| Field | Type | Description |
| --- | --- | --- |
| `assetsBase` | string | Asset base such as `/assets` or a CDN URL. |
| `assetsBaseMode` | string | Asset resolution mode. |

Modes:

| Value | Description |
| --- | --- |
| `base-first` | Prefer `assetsBase`. |
| `cdn-first` | Prefer the `@threejson/assets` CDN. |
| `local-first` | Prefer `/assets`. |
| `base-only` | Use only `assetsBase`. |
| `cdn-only` | Use only CDN. |
| `local-only` | Use only `/assets`. |

## 6. Common Object Fields

| Field | Type | Description |
| --- | --- | --- |
| `threeJsonId` | string | Stable ThreeJSON object ID. Recommended for any object that may be queried or mutated. |
| `objType` | string | Object type. |
| `name` | string | Three.js object name. |
| `label` | string | UI display label. |
| `refName` | string | Business reference name. |
| `visible` | boolean | Visibility. |
| `position` | Vector3 | Position. |
| `rotation` | Vector3 | Rotation. |
| `scale` | Vector3 or number | Scale. |
| `parent` / `parentId` | string | Parent reference. |
| `children` | array | Child records, commonly used by `group`. |
| `geometry` | object | Geometry parameters. |
| `material` | object/array | Material parameters. |
| `animations` | array/object | Animation configuration. |
| `events` | array/object | Event configuration. |
| `businessInfo` | object | Business metadata used by domains and UI. |
| `userData` | object | Additional data. |
| `customBucket` | string/array | Custom grouping bucket for visibility and queries. |

Vector3 object:

```json
{ "x": 1, "y": 2, "z": 3 }
```

Some fields allow partial vectors:

```json
{ "y": 2 }
```

## 7. Basic Geometry

### 7.1 Box

```json
{
  "threeJsonId": "box-1",
  "objType": "box",
  "geometry": { "width": 3, "height": 2, "depth": 1 },
  "material": { "type": "standard", "color": "#5470c6" }
}
```

### 7.2 Sphere

```json
{
  "threeJsonId": "sphere-1",
  "objType": "sphere",
  "geometry": { "radius": 2, "widthSegments": 32, "heightSegments": 16 },
  "material": { "type": "standard", "color": "#73c0de" }
}
```

### 7.3 Cylinder, Cone, Torus, Capsule

```json
{ "objType": "cylinder", "geometry": { "radiusTop": 1, "radiusBottom": 1, "height": 3, "radialSegments": 32 } }
```

```json
{ "objType": "cone", "geometry": { "radius": 1.5, "height": 3, "radialSegments": 32 } }
```

```json
{ "objType": "torus", "geometry": { "radius": 2, "tube": 0.35, "radialSegments": 16, "tubularSegments": 64 } }
```

```json
{ "objType": "capsule", "geometry": { "radius": 0.8, "length": 2, "capSegments": 8, "radialSegments": 16 } }
```

### 7.4 Plane

```json
{
  "objType": "plane",
  "geometry": { "width": 10, "height": 10 },
  "rotation": { "x": -1.5708, "y": 0, "z": 0 },
  "material": { "color": "#3a3f45", "side": "double" }
}
```

### 7.5 Group

```json
{
  "threeJsonId": "group-1",
  "objType": "group",
  "position": { "x": 0, "y": 0, "z": 0 },
  "children": [
    { "threeJsonId": "child-box", "objType": "box", "geometry": { "width": 1, "height": 1, "depth": 1 } }
  ]
}
```

## 8. Materials And Textures

### 8.1 Common Material Fields

```json
{
  "material": {
    "type": "standard",
    "color": "#5470c6",
    "roughness": 0.45,
    "metalness": 0.1,
    "transparent": true,
    "opacity": 0.85,
    "side": "double"
  }
}
```

| Field | Description |
| --- | --- |
| `type` | Material type. Common values include `basic`, `standard`, `physical`, `lambert`, `phong`. |
| `color` | Base color. |
| `opacity` | Opacity. Usually combine values below 1 with `transparent: true`. |
| `transparent` | Whether the material is transparent. |
| `side` | Render side: `front`, `back`, or `double`. |
| `roughness` | PBR roughness. |
| `metalness` | PBR metalness. |
| `emissive` | Emissive color. |
| `emissiveIntensity` | Emissive intensity. |
| `wireframe` | Wireframe rendering. |

### 8.2 Textures

```json
{
  "material": {
    "type": "standard",
    "color": "#ffffff",
    "map": "/assets/textures/wood.webp",
    "repeat": { "x": 2, "y": 2 },
    "anisotropy": 4,
    "minFilter": "linearMipmapLinear",
    "magFilter": "linear"
  }
}
```

| Field | Description |
| --- | --- |
| `map` / `textureUrl` | Color map. |
| `normalMap` | Normal map. |
| `roughnessMap` | Roughness map. |
| `metalnessMap` | Metalness map. |
| `emissiveMap` | Emissive map. |
| `alphaMap` | Alpha map. |
| `repeat` | Texture repeat. |
| `offset` | Texture offset. |
| `rotation` | Texture rotation. |
| `wrapS` / `wrapT` | Wrapping mode. |
| `anisotropy` | Anisotropic filtering. |
| `minFilter` / `magFilter` | Sampling filters. |
| `textureQuality` | Texture quality profile. |

## 9. External Models

```json
{
  "threeJsonId": "robot-1",
  "objType": "externalModel",
  "modelFileType": "gltf",
  "modelPath": "/assets/models/robot.glb",
  "position": { "x": 0, "y": 0, "z": 0 },
  "scale": { "x": 1, "y": 1, "z": 1 }
}
```

| Field | Description |
| --- | --- |
| `modelFileType` | Model format such as `gltf`, `glb`, `obj`, `fbx`, `stl`. |
| `modelPath` | Model file path. |
| `mtlPath` | OBJ material file path. |
| `mapsBasePath` | Texture base path. |
| `mapsFolderFallback` | Fallback texture folder. |
| `castShadow` / `receiveShadow` | Shadow configuration. |
| `animations` | Model animation configuration. |

## 10. Domain Objects

Domain objects map business semantics to Three.js objects.

```json
{
  "threeJsonId": "cabinet-1",
  "objType": "domain",
  "domain": "device.cabinet",
  "position": { "x": 0, "y": 0, "z": 0 },
  "businessInfo": {
    "label": "A01",
    "height": 8,
    "width": 2,
    "depth": 2
  }
}
```

| Field | Description |
| --- | --- |
| `objType` | Use `domain`. |
| `domain` | Domain ID, for example `device.cabinet`, `device.ups`, `nature.sky`. |
| `handler` | Optional handler selector used by some domains. |
| `businessInfo` | Business parameters. |
| `payload` / `options` | Domain extension parameters. |

When importing from `threejson/core`, make sure domains are registered:

```js
import "threejson/builtins/register";
```

## 11. Panels, Text, And CSS3D

### 11.1 `infoPanel`

```json
{
  "threeJsonId": "panel-1",
  "objType": "infoPanel",
  "position": { "x": 0, "y": 4, "z": 0 },
  "title": "Device Status",
  "items": [
    { "label": "Temperature", "value": "26 C" },
    { "label": "Status", "value": "Normal" }
  ]
}
```

### 11.2 `css3dPanel`

```json
{
  "threeJsonId": "css-panel-1",
  "objType": "css3dPanel",
  "position": { "x": 0, "y": 3, "z": 0 },
  "html": "<div class=\"panel\">Hello</div>"
}
```

CSS3D panels need a page integration that supports CSS3D rendering.

## 12. Events And Scripts

```json
{
  "threeJsonId": "door-1",
  "objType": "door",
  "events": {
    "click": [
      { "type": "toggleVisible", "target": "panel-1" }
    ],
    "dblclick": [
      { "type": "script", "source": "console.log('double click door')" }
    ]
  }
}
```

Common platform events:

| Event | Description |
| --- | --- |
| `click` | Click. |
| `dblclick` | Double click. |
| `pointerdown` / `pointerup` | Pointer down/up. |
| `pointermove` | Pointer move. |
| `mouseenter` / `mouseleave` | Pointer enter/leave. |

Available actions depend on the core event mechanism and registered domain capabilities.

## 13. Animation

```json
{
  "threeJsonId": "box-1",
  "objType": "box",
  "animations": [
    {
      "type": "rotation",
      "axis": "y",
      "speed": 0.8
    }
  ]
}
```

Available animation types depend on the current core and registered extensions. Editor-exported animation JSON is the best source of truth for complex cases.

## 14. Particles, Shaders, And Extensions

### 14.1 Particles

```json
{
  "threeJsonId": "particles-1",
  "objType": "points",
  "count": 1000,
  "position": { "x": 0, "y": 2, "z": 0 },
  "material": { "color": "#ffffff", "size": 0.05 }
}
```

Third-party particle providers may require extension imports:

```js
import "threejson/extensions/particle-nebula";
```

### 14.2 Shader Surface

```json
{
  "threeJsonId": "shader-1",
  "objType": "shaderSurface",
  "geometry": { "type": "plane", "width": 8, "height": 8 },
  "shader": { "preset": "water" }
}
```

Shader support depends on registered presets.

## 15. Sub-Scenes

`subSceneList` organizes larger scenes into reusable or independently manageable parts.

```json
{
  "subSceneList": [
    {
      "threeJsonId": "floor-a",
      "name": "Floor A",
      "objectList": [
        { "threeJsonId": "box-a1", "objType": "box", "geometry": { "width": 1, "height": 1, "depth": 1 } }
      ]
    }
  ]
}
```

Small projects can ignore sub-scenes.

## 16. IDs And Maintainability

Recommendations:

- Give every queryable, editable, interactive, or mutable object a `threeJsonId`.
- Keep `threeJsonId` unique within a scene.
- Use `name` for Three.js hierarchy display, `label` for UI display, and `refName` for business references.
- Keep geometry, material, and asset paths close to the object. Do not store runtime UI state in scene JSON.
- Do not write local absolute paths such as `E:\...` or `C:\...`.
- For GitHub Pages or subpath deployment, configure `assetsBase` instead of assuming `/assets`.

## 17. Format Conversion

```js
import {
  normalizeScenePayload,
  buildFriendlyScenePayloadFromCanonical,
  sceneToStandardJson,
  sceneToFriendlyJson
} from "threejson/core";

const standardPayload = normalizeScenePayload(friendlyPayload);
const friendlyPayload2 = buildFriendlyScenePayloadFromCanonical(
  standardPayload,
  standardPayload
);

const standardFromScene = await sceneToStandardJson(runtime.scene);
const friendlyFromScene = await sceneToFriendlyJson(runtime.scene);
```

The website example viewer's standard/friendly JSON switch uses these core capabilities.

## 18. Troubleshooting

| Symptom | Check First |
| --- | --- |
| Black canvas | Console errors, valid JSON, camera framing, lights, and object visibility. |
| Texture 404 | Asset base, GitHub Pages subpath, and file-name case. |
| Object mutation does not work | `threeJsonId`, object index, and whether the field supports incremental sync. |
| Domain does not deploy | Import `threejson` main entry or `threejson/builtins/register`. |
| Model does not load | `modelFileType`, model path, and texture paths. |
| `file://` module or cross-origin error | Serve the page through HTTP. |

# Capabilities, Particle V2, and WebGPU/TSL

This page is the contract for capabilities that are optional, preview, or easy to confuse with legacy behavior. The machine-readable source of truth is `getSceneCapabilityManifest()` from `threejson/capabilities` (also exported by `threejson/core`). It reports renderer backends, objects, materials, texture slots, post-processing passes, model formats, particle backends/sources, and controls as `stable`, `preview`, or `unavailable`.

```js
import { getSceneCapabilityManifest } from "threejson/capabilities";

const webgl = getSceneCapabilityManifest({ rendererBackend: "webgl" });
```

Unavailable declarations are hidden by default, so AI prompts and host UIs must not advertise them. Optional imports update the same registry. Scene loading validates explicitly unavailable combinations before deployment and throws `SceneCapabilityError` with structured `diagnostics` instead of silently creating an empty object.

## WebGL production path

WebGL remains the default. A minimal cube does not import WebGPU, raster particles, advanced post-processing, or extra controls and causes no capability-related network request.

- Friendly materials: `basic`, `lambert`, `phong`, `standard`, `physical`, `toon`, `matcap`, and `normal`.
- Physical fields include clearcoat, transmission, IOR, thickness/attenuation, sheen, iridescence, dispersion, specular, anisotropy, and their PBR texture slots.
- Renderer JSON supports tone mapping/exposure, output color space, shadow-map settings, power preference, logarithmic depth, and reversed depth.
- `unrealBloom`, `fxaa`, `smaa`, and registered `shaderPreset` passes are loaded only when a scene references them. An EffectComposer, RenderPass, and OutputPass are then assembled automatically.
- `shaderSurface` means registered WebGL GLSL preset plus typed uniforms; arbitrary shader source is not a `shaderSurface` feature.
- `instanced` accepts any registered geometry/material descriptor and optional per-instance color.
- `rectArea` lights, LOD, GLTF/GLB/OBJ/STL/PLY/FBX/USD/USDZ loading, and GLTF Draco/Meshopt/KTX2 configuration are declared in the capability manifest.

## Particle V2

An emitter has five independent blocks:

```json
{
  "objType": "particleEmitter",
  "source": { "type": "shell", "radius": 20, "thickness": 3 },
  "emission": { "mode": "continuous", "count": 5000, "rate": 800, "loop": true, "seed": 2026 },
  "particle": {
    "lifetime": { "min": 4, "max": 8 },
    "velocity": {
      "min": { "x": -0.2, "y": 0.1, "z": -0.2 },
      "max": { "x": 0.2, "y": 0.8, "z": 0.2 }
    },
    "sizeOverLife": [0, 4, 1],
    "colorOverLife": ["#60a5fa", "#ffffff", "#7c3aed"],
    "opacityOverLife": [0, 1, 0]
  },
  "simulation": {
    "backend": "cpu",
    "gravity": { "x": 0, "y": -0.1, "z": 0 },
    "drag": 0.03,
    "noise": { "strength": 0.1, "frequency": 1.2 },
    "attractors": [{ "position": { "x": 0, "y": 0, "z": 0 }, "strength": 8 }],
    "boundary": { "type": "wrap", "width": 60, "height": 60, "depth": 60 }
  },
  "render": { "type": "points", "size": 3, "blending": "additive", "depthWrite": false }
}
```

Sources: `positions`, `box`, `sphere`, `shell`, `disc`, `cone`, `line`, `curve`, and `meshSurface`. Emission modes: `static`, `continuous`, and `burst`. Boundaries: `none`, `wrap`, `bounce`, and `kill`. Rendering can use points or instanced billboards, sprites/atlases, per-particle color, size, opacity, and rotation.

`cpu` is the reference implementation. `webgl-compute` shares the descriptor instead of inventing a smaller schema. It validates the renderer's actual texture limit and never silently truncates particle count. A host may supply an explicit performance budget. The shared cross-backend contract currently allows up to 16 attractors and 8 keys per lifecycle curve; larger descriptors fail with a structured diagnostic instead of being truncated.

Text and image masks need browser Canvas/image decoding, so their implementation stays outside the default static load graph. Asynchronous `createJsonScene()` lazy-loads `threejson/particles-raster` only when a descriptor actually uses `textMask` or `imageMask`; ordinary scenes load nothing and make no image request. Hosts may also preload it explicitly:

```js
import "threejson/particles-raster";
```

Both paths enable `source.type: "textMask"` (`text`, `font`, `width`, `height`, `depth`) and `"imageMask"` (`url` or ImageData). CORS still applies to remote images. The synchronous `createJsonSceneSimple()` subset does not run optional-module loading; use the asynchronous entry.

Optional compute implementations register `simulation.backend` through `registerParticleSimulationBackend()` and lifecycle callbacks through `registerParticleSimulationLifecycle()`.

## Explicit WebGPU/TSL preview

WebGPU is opt-in. Three.js r184 is the continuously tested adapter baseline, but the test matrix is not treated as a capability ban: other revisions run in `best-effort` mode with a warning by default, while a host that requires a certified combination can select `strict`:

```js
import "threejson/webgpu";
import { createJsonScene } from "threejson/core";

const result = await createJsonScene(payload, { canvas });
```

```json
{
  "sceneConfig": {
    "renderer": {
      "backend": "webgpu",
      "revisionPolicy": "best-effort",
      "compatibilityPolicy": "error"
    }
  }
}
```

`createSceneRuntime()` remains synchronous and WebGL-only. Use `createSceneRuntimeAsync()` or `createJsonScene()` for WebGPU initialization. WebGPU rendering can use render/output/bloom RenderPipeline records and `simulation.backend: "webgpu-compute"`. If a scene contains GLSL ShaderMaterial or a WebGL-only pass, loading fails with diagnostics. Set `compatibilityPolicy: "fallback-webgl"` only when an explicit whole-scene fallback is acceptable.

### TSL preset

```json
{
  "material": {
    "type": "tsl",
    "base": "standard",
    "tsl": {
      "kind": "preset",
      "preset": "uv-gradient",
      "params": { "colorA": "#2563eb", "colorB": "#f97316" }
    }
  }
}
```

Built-in preview presets are `solid`, `uv-gradient`, and `pulse`; hosts can call `registerTslPreset()`. Complex effects such as burning and dissolve are not hard-coded as one-off branches for a particular example; they can be composed from the generic graph nodes below or from a code module.

### TSL graph

```json
{
  "material": {
    "type": "tsl",
    "base": "physical",
    "roughness": 0.35,
    "tsl": {
      "kind": "graph",
      "source": {
        "inline": {
          "graphVersion": 1,
          "nodes": [
            { "id": "uv", "type": "uv" },
            { "id": "uvY", "type": "swizzle", "input": "uv", "components": "y" },
            { "id": "a", "type": "color", "value": "#1d4ed8" },
            { "id": "b", "type": "color", "value": "#fb923c" },
            { "id": "mix", "type": "mix", "a": "a", "b": "b", "factor": "uvY" }
          ],
          "outputs": { "color": "mix" }
        }
      }
    }
  }
}
```

Graph version 1 validates node count, unique IDs, references, cycles, supported node types, outputs, URL/CORS failures, and texture loading. Supported nodes cover constants/uniforms/time, UV/position/normal/texture, arithmetic, mix/smoothstep/clamp, common unary operations, regular noise, fractal noise, and swizzle. A `call` node can invoke callable exports actually present in `three/tsl`; hosts may add serializable nodes through `registerTslGraphNode()`. Outputs may target any safe `*Node` property actually exposed by the selected NodeMaterial instead of a stale engine-maintained output whitelist.

### External-model material bindings

After a GLTF/GLB asset loads, its material slots can be selected by node name, node path, node type, mesh index, material name, or material index and replaced with any registered material, including TSL:

```json
{
  "objType": "externalModel",
  "modelFileType": "glb",
  "modelPath": "/assets/head.glb",
  "materialBindings": [{
    "selector": { "nodeName": "Head*" },
    "required": true,
    "material": {
      "type": "tsl",
      "base": "standard",
      "transparent": true,
      "tsl": { "kind": "graph", "source": { "url": "/materials/burn.graph.json" } }
    }
  }]
}
```

See `examples/webgpu/tsl-burning-model.json` for a runnable complete inline burning graph. An empty selector or `{ "all": true }` matches every material slot; string selectors support `*` and `?`. `mode` is `replace` (default) or `patch`, and `shareMaterial` controls sharing across matching slots. TSL replacement materials also accept `inheritOriginal: "textures" | "all"` to retain the GLTF material's maps or all compatible properties. `required` or top-level `materialBindingsStrict` turns an unmatched binding into a structured error.

### TSL code execution policy

TSL code is a JavaScript module with the same page permissions as the host; it is not restricted shader text. Importing the optional entry is the host's explicit capability opt-in, and it also registers WebGPU/TSL, so a second `threejson/webgpu` import is unnecessary. The default `trusted` policy preserves ordinary ESM capability. Scene JSON cannot change host policy.

```js
import { configureTslCodeExecution } from "threejson/tsl-code";

configureTslCodeExecution({
  executionPolicy: "prompt",
  authorize: async ({ hash, source, notice }) => showUserConfirmation({ hash, source, notice })
});
```

Available policies are:

- `trusted` (default): loads the module and its normal ESM dependencies; suited to author-owned content, offline tools, and trusted projects.
- `prompt`: asks the host about the exact source hash, then retains normal ESM dependencies.
- `restricted`: asks for confirmation and rejects static or dynamic imports; suited to sites that accept only self-contained modules.
- `disabled`: disables code while preset and graph remain available.

The module default-exports a `(params, context) => result` factory. `TSL`, `WEBGPU`, the descriptor, and the target material are supplied through `context`. The factory may return a complete NodeMaterial, one TSL node, an output-node map, or mutate `context.material` and return nothing. URL modules are imported from their original URL so relative dependencies resolve normally. Inline modules can use the host import map, or a `moduleLoader` can connect a bundler, CSP, or custom resolver. `source.sha256` optionally verifies integrity. The host chooses policy according to content provenance; the engine does not globally remove capability on behalf of every application.

## Other stable additions

- `objType: "lod"` uses `levels: [{ distance, hysteresis, object }]` and preserves the authoritative nested descriptors on export.
- Shared curves support Line, CatmullRom, Quadratic/Cubic Bezier, Ellipse, and CurvePath. They are consumed by tubes, lines, path animations, and particles.
- `morph.list` and `morph.set` query and update named/indexed morph targets. Descriptors may use `morphInfluences`; declarative `morph` animation is also available.
- Asynchronous `createJsonScene()` lazy-loads MapControls, TrackballControls, and ArcballControls when their descriptors are present; hosts may also preload `threejson/controls-extra`. TransformControls remains an editor concern.

See the runnable fixtures under `examples/particle-v2/`, `examples/webgpu/`, and `examples/capabilities/`.

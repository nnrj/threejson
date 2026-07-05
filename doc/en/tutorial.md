# ThreeJSON Tutorial Catalog

[中文](../tutorial.md) | [English](./tutorial.md)

This catalog matches [demo.html](../../demo.html): **Tracks 0 → 7** from core runtime contracts through tooling, host apps, the stat domain, and scene text.

**How to run**: start a static server at the repo root (`python -m http.server 8080`), then open `http://localhost:8080/demo.html`.

## Track 0 · Runtime and JSON contracts

| ID | Prereq | Title | HTML | JSON |
|----|--------|-------|------|------|
| t00-01 | — | Minimal scene | [00-01-minimal-mesh.html](../../examples/html-demo/track-00-runtime/00-01-minimal-mesh.html) | [00-01-minimal-mesh.json](../../assets/json/tutorial/track-00/00-01-minimal-mesh.json) |
| t00-02 | t00-01 | Primitives and materials | [00-02-primitives-materials.html](../../examples/html-demo/track-00-runtime/00-02-primitives-materials.html) | [00-02-primitives.json](../../assets/json/tutorial/track-00/00-02-primitives.json) |
| t00-03 | t00-02 | Friendly JSON full scene | [00-03-friendly-full-scene.html](../../examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html) | [00-03-friendly-full-scene.json](../../assets/json/tutorial/track-00/00-03-friendly-full-scene.json) |
| t00-04 | t00-03 | Standard objectList | [00-04-standard-objectlist.html](../../examples/html-demo/track-00-runtime/00-04-standard-objectlist.html) | [00-04-standard-objectlist.json](../../assets/json/tutorial/track-00/00-04-standard-objectlist.json) |
| t00-05 | t00-01 | Import paths (split vs import map) | [00-05-import-paths.html](../../examples/html-demo/track-00-runtime/00-05-import-paths.html) | [00-03-friendly-full-scene.json](../../assets/json/tutorial/track-00/00-03-friendly-full-scene.json) |
| t00-06 | t00-01 | Resource reclaim | [00-06-resource-reclaimer.html](../../examples/html-demo/track-00-runtime/00-06-resource-reclaimer.html) | — |
| t00-08 | t00-01 | sceneConfig.intro splash | [00-08-scene-intro.html](../../examples/html-demo/track-00-runtime/00-08-scene-intro.html) | [00-08-scene-intro.json](../../assets/json/tutorial/track-00/00-08-scene-intro.json) |
| t00-07 | t00-01 | Manual single-object deploy (**optional**) | [00-07-manual-deploy-mesh.html](../../examples/html-demo/track-00-runtime/00-07-manual-deploy-mesh.html) | — (inline box record) |

After this track you should: load friendly/standard scenes with `createJsonScene` (from t00-01), understand normalize → phased deploy on `objectList`; t00-06 for reclaim APIs; t00-08 for postLoad intro and load gate; optionally t00-07 for the imperative `deployMesh` path.

## Track 1 · Scene objects and geometry

| ID | Prereq | Title | HTML | JSON |
|----|--------|-------|------|------|
| t01-01 | t00-03 | Groups, lines, and panels | [01-01-group-line-panel.html](../../examples/html-demo/track-01-geometry/01-01-group-line-panel.html) | [01-01-group-line-panel.json](../../assets/json/tutorial/track-01/01-01-group-line-panel.json) |
| t01-02 | t01-01 | Planes and line topology | [01-02-plane-line-topology.html](../../examples/html-demo/track-01-geometry/01-02-plane-line-topology.html) | [01-02-plane-line-topology.json](../../assets/json/tutorial/track-01/01-02-plane-line-topology.json) |
| t01-03 | t00-03 | Preset objTypes | [01-03-preset-objtypes.html](../../examples/html-demo/track-01-geometry/01-03-preset-objtypes.html) | [01-03-preset-objtypes.json](../../assets/json/tutorial/track-01/01-03-preset-objtypes.json) |
| t01-04 | t01-03 | CSG joins and holes | [01-04-csg-joins.html](../../examples/html-demo/track-01-geometry/01-04-csg-joins.html) | [01-04-csg-joins.json](../../assets/json/tutorial/track-01/01-04-csg-joins.json) |
| t01-05 | t01-02 | Helpers and irregular geometry | [01-05-helpers-irregular-geometry.html](../../examples/html-demo/track-01-geometry/01-05-helpers-irregular-geometry.html) | [01-05-helpers-irregular.json](../../assets/json/tutorial/track-01/01-05-helpers-irregular.json) |
| t01-06 | t00-04, t01-02 | Native generic objects | [01-06-native-object-dispatch.html](../../examples/html-demo/track-01-geometry/01-06-native-object-dispatch.html) | [01-06-native-objects.json](../../assets/json/tutorial/track-01/01-06-native-objects.json) |
| t01-07 | t01-06 | JSM geometry and asset refs | [01-07-jsm-geometries.html](../../examples/html-demo/track-01-geometry/01-07-jsm-geometries.html) | [01-07-jsm-geometries.json](../../assets/json/tutorial/track-01/01-07-jsm-geometries.json) |
| t01-08 | t01-07 | Orthographic camera + Fly controls | [01-08-ortho-fly.html](../../examples/html-demo/track-01-geometry/01-08-ortho-fly.html) | [01-08-ortho-fly.json](../../assets/json/tutorial/track-01/01-08-ortho-fly.json) |

## Track 2 · Visualization and effects

| ID | Prereq | Title | HTML | JSON |
|----|--------|-------|------|------|
| t02-01 | t00-03 | Heatmap and wind strips | [02-01-heatmap-wind.html](../../examples/html-demo/track-02-visual-fx/02-01-heatmap-wind.html) | [02-01-heatmap-wind.json](../../assets/json/tutorial/track-02/02-01-heatmap-wind.json) |
| t02-02 | t02-01 | Points and motion | [02-02-points-motion.html](../../examples/html-demo/track-02-visual-fx/02-02-points-motion.html) | [02-02-points-motion.json](../../assets/json/tutorial/track-02/02-02-points-motion.json) |
| t02-03 | t02-02 | Weather domain | [02-03-weather-domain.html](../../examples/html-demo/track-02-visual-fx/02-03-weather-domain.html) | [02-03-weather-domain.json](../../assets/json/tutorial/track-02/02-03-weather-domain.json) |
| t02-04 | t02-01 | Sprite / tube / instanced | [02-04-sprite-tube-instanced.html](../../examples/html-demo/track-02-visual-fx/02-04-sprite-tube-instanced.html) | [02-04-sprite-tube-instanced.json](../../assets/json/tutorial/track-02/02-04-sprite-tube-instanced.json) |
| t02-05 | t00-04 | Scene background and panorama | [02-05-scene-background.html](../../examples/html-demo/track-02-visual-fx/02-05-scene-background.html) | [02-05-scene-background.json](../../assets/json/tutorial/track-02/02-05-scene-background.json) |
| t02-06 | t00-03 | Spatial audio | [02-06-audio-spatial.html](../../examples/html-demo/track-02-visual-fx/02-06-audio-spatial.html) | [02-06-audio-spatial.json](../../assets/json/tutorial/track-02/02-06-audio-spatial.json) |
| t02-09 | t02-02 | particleEmitter gpuCompute | [02-09-particle-emitter-gpu.html](../../examples/html-demo/track-02-visual-fx/02-09-particle-emitter-gpu.html) | [02-09-particle-emitter-gpu.json](../../assets/json/tutorial/track-02/02-09-particle-emitter-gpu.json) |
| t02-10 | t02-09 | particleEmitter third-party provider | [02-10-particle-nebula-provider.html](../../examples/html-demo/track-02-visual-fx/02-10-particle-nebula-provider.html) | [02-10-particle-nebula-provider.json](../../assets/json/tutorial/track-02/02-10-particle-nebula-provider.json) |
| t02-11 | t02-06 | textureQuality texture sampling tiers | [02-11-texture-sampling-toggle.html](../../examples/html-demo/track-02-visual-fx/02-11-texture-sampling-toggle.html) | [02-11-texture-sampling-toggle.json](../../assets/json/tutorial/track-02/02-11-texture-sampling-toggle.json) |
| t02-sky | t00-03 | Shader sky and water (folder) | [02-08-shader-sky-cycle.html](../../examples/html-demo/track-02-visual-fx/02-08-shader-sky-cycle.html) | — |
| t02-07 | t02-sky | Static sky and ocean | [02-07-shader-sky-water.html](../../examples/html-demo/track-02-visual-fx/02-07-shader-sky-water.html) | [02-07-shader-sky-water.json](../../assets/json/tutorial/track-02/02-07-shader-sky-water.json) |
| t02-08 | t02-07 | Sky day/night cycle | [02-08-shader-sky-cycle.html](../../examples/html-demo/track-02-visual-fx/02-08-shader-sky-cycle.html) | [02-08-shader-sky-cycle.json](../../assets/json/tutorial/track-02/02-08-shader-sky-cycle.json) |

## Track 3 · External assets and domains

| ID | Prereq | Title | HTML | JSON |
|----|--------|-------|------|------|
| t03-01 | t00-04 | glTF external models | [03-01-external-gltf.html](../../examples/html-demo/track-03-assets/03-01-external-gltf.html) | [03-01-external-gltf.json](../../assets/json/tutorial/track-03/03-01-external-gltf.json) |
| t03-02 | t03-01 | glTF animation mixer | [03-02-gltf-animation-mixer.html](../../examples/html-demo/track-03-assets/03-02-gltf-animation-mixer.html) | [03-02-gltf-animation-mixer.json](../../assets/json/tutorial/track-03/03-02-gltf-animation-mixer.json) |
| t03-03 | t03-01 | Native Three JSON domain | [03-03-native-three-domain.html](../../examples/html-demo/track-03-assets/03-03-native-three-domain.html) | [03-03-native-three-domain.json](../../assets/json/tutorial/track-03/03-03-native-three-domain.json) |
| t03-04 | t03-01 | OBJ and maps fallback | [03-04-obj-maps-fallback.html](../../examples/html-demo/track-03-assets/03-04-obj-maps-fallback.html) | [03-04-obj-maps-fallback.json](../../assets/json/tutorial/track-03/03-04-obj-maps-fallback.json) |
| t03-06 | t03-02 | animationGraph state machine | [03-06-animation-graph.html](../../examples/html-demo/track-03-assets/03-06-animation-graph.html) | [03-06-animation-graph.json](../../assets/json/tutorial/track-03/03-06-animation-graph.json) |

## Track 4 · Runtime interaction and extensions (LAB)

| ID | Prereq | Title | HTML | JSON |
|----|--------|-------|------|------|
| t04-01 | t00-02 | Object registry | [04-01-object-registry.html](../../examples/html-demo/track-04-interaction/04-01-object-registry.html) | [04-01-object-registry.json](../../assets/json/tutorial/track-04/04-01-object-registry.json) |
| t04-02 | t00-04 | PluginHost and physics | [04-02-plugin-physics.html](../../examples/html-demo/track-04-interaction/04-02-plugin-physics.html) | [04-02-plugin-physics.json](../../assets/json/tutorial/track-04/04-02-plugin-physics.json) |
| t04-fps | t04-02 | First-person walk (folded) | default [04-05-fps-rapier-collision.html](../../examples/html-demo/track-04-interaction/04-05-fps-rapier-collision.html) | — |
| t04-03 | t00-04 | ↳ Basic walk | [04-03-fps-walk.html](../../examples/html-demo/track-04-interaction/04-03-fps-walk.html) | [04-03-fps-walk.json](../../assets/json/tutorial/track-04/04-03-fps-walk.json) |
| t04-04 | t04-03 | ↳ Player rig | [04-04-fps-player-rig.html](../../examples/html-demo/track-04-interaction/04-04-fps-player-rig.html) | [04-04-fps-player-rig.json](../../assets/json/tutorial/track-04/04-04-fps-player-rig.json) |
| t04-05 | t04-02, t04-03 | ↳ Rapier collision | [04-05-fps-rapier-collision.html](../../examples/html-demo/track-04-interaction/04-05-fps-rapier-collision.html) | [04-05-fps-rapier-collision.json](../../assets/json/tutorial/track-04/04-05-fps-rapier-collision.json) |
| t04-08 | t00-04 | Info panel gallery | [04-08-info-panel-gallery.html](../../examples/html-demo/track-04-interaction/04-08-info-panel-gallery.html) | [04-08-info-panel-gallery.json](../../assets/json/tutorial/track-04/04-08-info-panel-gallery.json) |
| t04-09 | t04-01 | Event mechanism and EventScript | [04-09-event-mechanism.html](../../examples/html-demo/track-04-interaction/04-09-event-mechanism.html) | [04-09-event-mechanism.json](../../assets/json/tutorial/track-04/04-09-event-mechanism.json) |
| t04-10 | t04-09 | Per-object lifecycle (ready / dispose) | [04-10-object-lifecycle.html](../../examples/html-demo/track-04-interaction/04-10-object-lifecycle.html) | [04-10-object-lifecycle.json](../../assets/json/tutorial/track-04/04-10-object-lifecycle.json) |
| t04-11 | t04-09 | Declarative actions | [04-11-declarative-actions.html](../../examples/html-demo/track-04-interaction/04-11-declarative-actions.html) | [04-11-declarative-actions.json](../../assets/json/tutorial/track-04/04-11-declarative-actions.json) |
| t04-06 | t00-04 | CSS3D interactive panel | [04-06-css3d-panel.html](../../examples/html-demo/track-04-interaction/04-06-css3d-panel.html) | [04-06-css3d-panel.json](../../assets/json/tutorial/track-04/04-06-css3d-panel.json) |
| t04-07 | t04-06 | ↳ Curved-screen browser | [04-07-css3d-curved-browser.html](../../examples/html-demo/track-04-interaction/04-07-css3d-curved-browser.html) | [04-07-css3d-curved-google.json](../../assets/json/tutorial/track-04/04-07-css3d-curved-google.json) |

## Track 5 · Tooling

| ID | Prereq | Title | Entry |
|----|--------|-------|-------|
| t05-01 | t00-04 | AI scene generation | [05-01-ai-scene.html](../../examples/html-demo/track-05-tooling/05-01-ai-scene.html) |
| t05-02a | t02-03 | Nested subdomains (weather.rain / weather.wind) | [05-02-nested-domain.html](../../examples/html-demo/track-05-tooling/05-02-nested-domain.html) |

## Track 5 · Host application samples

| ID | Prereq | Title | Entry |
|----|--------|-------|-------|
| t05-02 | t00-04 | Core network room zone A | [room-show.html](../../room-show.html) |
| t05-03 | t00-04 | Scene editor | [scene-editor.html](../../scene-editor.html) |
| t05-04 | t00-04 | Scene player | [scene-player.html](../../scene-player.html) |
| t05-05 | t05-02 | Smart port | [port-show.html](../../port-show.html) |

## Track 6 · Statistics and visualization (stat domain)

| ID | Prereq | Title | HTML | JSON |
|----|--------|-------|------|------|
| t06-stat | t00-04, t04-06 | stat domain (folded) | default [06-04-stat-chart-echarts.html](../../examples/html-demo/track-06-stat/06-04-stat-chart-echarts.html) | — |
| t06-01 | t00-04 | ↳ stat.bar | [06-01-stat-bar.html](../../examples/html-demo/track-06-stat/06-01-stat-bar.html) | [06-01-stat-bar.json](../../assets/json/tutorial/track-06/06-01-stat-bar.json) |
| t06-02 | t06-01 | ↳ stat.grid | [06-02-stat-grid.html](../../examples/html-demo/track-06-stat/06-02-stat-grid.html) | [06-02-stat-grid.json](../../assets/json/tutorial/track-06/06-02-stat-grid.json) |
| t06-03 | t06-02 | ↳ stat.panel | [06-03-stat-panel.html](../../examples/html-demo/track-06-stat/06-03-stat-panel.html) | [06-03-stat-panel.json](../../assets/json/tutorial/track-06/06-03-stat-panel.json) |
| t06-04 | t06-03, t04-06 | ↳ stat.chart + ECharts | [06-04-stat-chart-echarts.html](../../examples/html-demo/track-06-stat/06-04-stat-chart-echarts.html) | [06-04-stat-chart-echarts.json](../../assets/json/tutorial/track-06/06-04-stat-chart-echarts.json) |
| t06-05 | t06-04 | ↳ stat.line | [06-05-stat-line.html](../../examples/html-demo/track-06-stat/06-05-stat-line.html) | [06-05-stat-line.json](../../assets/json/tutorial/track-06/06-05-stat-line.json) |
| t06-06 | t06-05 | ↳ stat.pie | [06-06-stat-pie.html](../../examples/html-demo/track-06-stat/06-06-stat-pie.html) | [06-06-stat-pie.json](../../assets/json/tutorial/track-06/06-06-stat-pie.json) |
| t06-07 | t06-06 | ↳ stat.pie + stat.ring | [06-07-stat-pie-ring.html](../../examples/html-demo/track-06-stat/06-07-stat-pie-ring.html) | [06-07-stat-pie-ring.json](../../assets/json/tutorial/track-06/06-07-stat-pie-ring.json) |

## Track 7 · Scene text (`objType: text`)

| ID | Prereq | Title | HTML | JSON |
|----|--------|-------|------|------|
| t07-text | t00-04 | text objects (folded) | default [07-02-text-mesh.html](../../examples/html-demo/track-07-text/07-02-text-mesh.html) | — |
| t07-01 | t00-04 | ↳ sdf / texture | [07-01-text-modes.html](../../examples/html-demo/track-07-text/07-01-text-modes.html) | [07-01-text-modes.json](../../assets/json/tutorial/track-07/07-01-text-modes.json) |
| t07-02 | t07-01 | ↳ mesh extruded text | [07-02-text-mesh.html](../../examples/html-demo/track-07-text/07-02-text-mesh.html) | [07-02-text-mesh.json](../../assets/json/tutorial/track-07/07-02-text-mesh.json) |

Track 7 HTML pages include `troika-three-text` + `fflate` in the import map (SDF mode). Other tutorial pages omit them; troika is lazy-loaded only when needed.

## Roadmap (no standalone demo yet)

Aligned with [json-format.md § Out of scope](../json-format.md#暂不纳入当前-json-主线的能力) (Chinese): skeletal animation state machines, more formats (FBX/STL), advanced descriptorBinding / spatial-query lessons, dedicated mesh import/export tutorials, etc.

## Adding a new lesson

1. Add JSON under `assets/json/tutorial/track-XX/`.
2. Add HTML under `examples/html-demo/track-XX-*/` (copy the [00-03-friendly-full-scene template](../../examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html)).
3. Add entries to [`demo-catalog.zh.json`](../../examples/html-demo/demo-catalog.zh.json) and [`demo-catalog.en.json`](../../examples/html-demo/demo-catalog.en.json) (each locale file is self-contained; `demo.html` loads one by locale), and update this syllabus. Run `npm run validate:demo-catalog` to verify zh/en structural parity.
4. Do not point catalog `path` at non-track legacy pages; add new lessons under `track-*`.
5. For lessons using SDF text, keep `troika-three-text` + `fflate` in the page import map (see Track 7).

Catalog metadata: [`demo-catalog.zh.json`](../../examples/html-demo/demo-catalog.zh.json) and [`demo-catalog.en.json`](../../examples/html-demo/demo-catalog.en.json) (full per-locale arrays). Nested nav items (FPS, stat, text, CSS3D curved screen) use **different HTML paths per step** so the iframe actually switches scenes.

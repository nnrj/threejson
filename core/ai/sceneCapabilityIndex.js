/**
 * Compact ThreeJSON capability index for AI prompts.
 *
 * Keep this file concise: it is sent to LLMs more often than human docs. Longer explanations and
 * runnable examples stay in docs/ and assets/json/tutorial/.
 */

const THREE_JSON_AGENT_CAPABILITY_INDEX = `
ThreeJSON capability index (choose the most appropriate/specific feature for what's described; this is not a checklist):

Selection principle:
- Prefer basic primitives and semantic presets when they fully satisfy the user's scene.
- For grounded scenes (rooms, buildings, campuses, streets, gardens, factories, exhibits, furniture layouts, game levels, dashboards standing in space), include an appropriate floor/ground/base plane even when the user does not spell out "floor"; omit it only for floating/space/abstract scenes where no support surface is implied.
- Use advanced/native/domain/effect features only when the user explicitly asks for them or the scene clearly needs them.
- Do not add lineList, particleEmitter, shaderSurface, native geometry, domain records, audio, or lifecycle scripts just to demonstrate capability.
- lineList is for visible paths/routes/cables/boundaries/outlines; particleEmitter is only for explicit particles, rain, snow, dust, sparks, starfields, smoke, magic, or similar requested atmospheric effects. A normal scene should not get particles as default decoration.
- Standalone scenes should include reliable general lighting: at least ambient + directional unless the user asks for darkness. Point/spot lights are local accents and need much higher intensity than ambient/directional due to distance falloff.
- If a requested edit targets size/color/position of an existing object, preserve unrelated dimensions and materials unless the user asks to change them.

Authoring shapes:
- Friendly JSON: sceneConfig + worldInfo lists; best for hand-authored and AI scenes.
- Standard JSON: threeJsonId + sceneConfig + objectList; best for diffs, commands, editor/API flows.
- objectList may also include runtime records: scene, camera, renderer, controls, light, renderLoop, pass.

Geometry and composition:
- Basic primitives: box/floor/wall/glass/door/cabinet/road, sphere, cylinder, cone, torus, ring, capsule, plane.
- Complex geometry: shapePlane, shapeExtrude, irregularPlane, irregularGeometry, bufferMesh, CSG joins/inters/holes.
- Native Three.js inference: objType native, geometry.type (TorusKnotGeometry, LatheGeometry, DodecahedronGeometry, etc.), parseMode auto|native, geometryRef/materialRef via assetLibrary.
- Reuse and scale: groupList/subScene for assemblies, instancedList for repeated props, lineList only for visible paths/boundaries, tubeList for pipes/splines, spriteList for billboards.

Materials, assets, and rendering:
- Materials support standard/phong/lambert/basic/physical-like fields, textureUrl/map, normal/roughness/metalness/emissive/alpha maps, repeat/offset/rotation/wrap/filter/anisotropy.
- sceneConfig.textureQuality controls default texture sampling; per-material textureSampling can override.
- assetLibrary can hold geometryPreset/materialPreset/shaderSource/eventScript and lib:// references.
- sceneConfig supports scene background/environment/fog, perspective or orthographic camera, orbit/firstPerson/fly controls, lights, helpers, renderLoop, passList/post-processing, intro.postLoad.

Effects and media:
- shaderSurface for requested custom/preset shader surfaces; particleEmitter for CPU/GPU particles only when an effect/weather/particle field is actually needed; particleList/points only for legacy point clouds.
- windList, heatList, weather domains, nature.sky, nature.water, sprites, tubes.
- audioList supports ambient or positional audio attached to scene/camera/object; use audioUrl and sensible playback policy fields.
- externalModelList/objModelList load GLTF/GLB/OBJ-style assets; animationMode mixer and animationGraph support clip state machines.

Domains:
- domainModelList / objType domain dispatches built-in domains: floor, wall, glass, door, box, nativeThree, weather(.rain/.wind), nature(.sky/.water), stat(.bar/.grid/.panel/.chart/.line/.pie/.ring), device(.cabinet/.server/.ups/.switch/.airConditioner), port, sceneHighlight.
- A domain item is a record like { objType:"domain", domain:"device.cabinet", handler:"createCabinet", payload:{...} } or { domain:"stat.bar", handler:"createStatBars", items:[...] }. It is not a box record inside domainModelList.
- Use domain records when the user asks for business objects (cabinet, server rack, UPS, switch, port crane, stat panel/chart, sky/water/weather) instead of hand-building only boxes.

Interaction and lifecycle:
- Use events on deployable objects for click/dblclick/pointer/keyboard plus scene.ready, scene.dispose, object.ready, object.dispose.
- Prefer actions for simple toggles/moves/patches; use EventScript DSL for short sequences: self.moveBy(...), wait(ms), ref("id"), run object.patch ...
- sceneConfig.eventScript configures DSL/javascript mode, maxSteps, and allowed run commands. Keep scripts short and scene-local.
- object lifecycle can be enabled with sceneConfig.interaction.enableObjectLifecycle when object.ready/object.dispose behavior matters.

Command and patch editing:
- Core command mode supports scene.list, scene.validate, scene.applyPatch, scene.export, object.get/add/remove/patch/reconcile, material.patch, camera.fit.
- Use commands for small edits and full JSON for broad restructuring. Use JSON Patch for minimal document-level edits when paths are clear.
`;

const THREE_JSON_AGENT_EXAMPLE_INDEX = `
Capability patterns:
- Domain object: worldInfo.domainModelList item with domain + handler + payload/items/options; do not use objType box in domainModelList.
- Interactive object: add events.click.actions with object.toggleVisible / object.moveBy, or events.click.script for short EventScript.
- Lifecycle intro/spawn: use sceneConfig.intro.postLoad for a splash; use events["object.ready"] for per-object creation motion.
- Animated imported model: externalModel with animationMode "mixer", renderLoop.updateAnimations true, and animationGraph { parameters, states, transitions }.
- Dashboard: stat domain records for charts + infoPanel for static labels + css3dPanel only for interactive DOM.
- Advanced shape: native geometry.type or shapeExtrude/irregularGeometry; do not approximate all curved/custom shapes as boxes.
- Repeated city/forest/servers: instancedList or grouped subScene, not hundreds of unrelated root boxes.
`;

export {
  THREE_JSON_AGENT_CAPABILITY_INDEX,
  THREE_JSON_AGENT_EXAMPLE_INDEX
};

/**
 * Compact ThreeJSON capability index for AI prompts.
 *
 * Keep this file concise: it is sent to LLMs more often than human docs. Longer explanations and
 * runnable examples stay in docs/ and assets/json/tutorial/.
 */
import { THREE_JSON_DOMAIN_CAPABILITY_INDEX } from "./sceneDomainCapability.js";

const THREE_JSON_AGENT_CAPABILITY_INDEX_BASE = `
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
- Standard AI JSON: threeJsonId + sceneConfig + one heterogeneous objectList; every item has an explicit objType. This is the required generation/editing format.
- Friendly worldInfo lists are a human-facing compatibility projection only; do not emit them unless the host converts the final standard result.
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
- A domain item is a record like { objType:"domain", domain:"device.cabinet", handler:"deployCabinet", geometry:{width:6,length:12,height:20}, position:{x:0,y:0,z:0} } or { domain:"stat.bar", handler:"createStatBars", items:[...] }. Domain-specific fields may be direct or use payload only when that domain documents it. It is not a box record inside domainModelList.
- Use domain records when the user asks for business objects (cabinet, server rack, UPS, switch, port crane, stat panel/chart, sky/water/weather) instead of hand-building only boxes.

${THREE_JSON_DOMAIN_CAPABILITY_INDEX.trim()}

Interaction and lifecycle:
- Use events on deployable objects for click/dblclick/pointer/keyboard plus scene.ready, scene.dispose, object.ready, object.dispose.
- Prefer actions for simple toggles/moves/patches; use EventScript DSL for finite sequences. Detailed animation/script syntax is injected only when pre-generation negotiation selects it.
- sceneConfig.eventScript configures DSL/javascript mode, maxSteps, and allowed run commands. Keep scripts short and scene-local.
- object lifecycle can be enabled with sceneConfig.interaction.enableObjectLifecycle when object.ready/object.dispose behavior matters.

Scene text (capability id: sceneText):
- Visible words, titles, captions, object names, floor labels, and floating labels use objectList objType text. Prefer mode:"sdf" for requested plain text; use infoPanel only when a visible panel/card/sign backing is requested, and mode:"mesh" only for explicit extruded/beveled solid lettering.
- TextItem uses content, fontSize, color, position, optional billboard/anchor/align and sdf styling. Do not substitute descriptor name/label for visible content.

Command and patch editing:
- Core command mode supports scene.list, scene.validate, scene.applyPatch, scene.export, object.get/add/remove/patch/reconcile, material.patch, camera.fit.
- Use commands for small edits and full JSON for broad restructuring. Use JSON Patch for minimal document-level edits when paths are clear.
`;

const THREE_JSON_AGENT_ONLINE_TEXTURE_INDEX = `
Online texture hints:
- When enabled, use a real reachable online material.textureUrl by default when a described object or surface would look wrong or ambiguous as a flat color: named planets, terrain/grass/water, asphalt, brick/concrete/wood/stone/fabric, signs/screens/maps, paintings, labels, carpets, and other recognizable image-bearing or patterned things. The URL can come from any suitable public web source, not only a CDN; https is preferred when available. Add textureRepeat for large tiled surfaces. Keep flat colors for abstract/simple blockouts and plain colored objects.
`;

function buildAgentCapabilityIndex(options = {}) {
  return [
    THREE_JSON_AGENT_CAPABILITY_INDEX_BASE.trim(),
    options.onlineTextureHints === true ? THREE_JSON_AGENT_ONLINE_TEXTURE_INDEX.trim() : ""
  ].filter(Boolean).join("\n\n");
}

const THREE_JSON_AGENT_CAPABILITY_INDEX = buildAgentCapabilityIndex();

const THREE_JSON_AGENT_EXAMPLE_INDEX = `
Capability patterns:
- Domain object: objectList item with objType domain + domain + handler + payload/items/options.
- Interactive object: add events.click.actions with object.toggleVisible / object.moveBy, or events.click.script for short EventScript.
- Lifecycle intro/spawn: use sceneConfig.intro.postLoad for a splash; use events["object.ready"] for finite per-object creation motion. Use declarative per-frame animation for continuous motion.
- Animated imported model: externalModel with animationMode "mixer", renderLoop.updateAnimations true, and animationGraph { parameters, states, transitions }.
- Dashboard: stat domain records for charts + infoPanel for static labels + css3dPanel only for interactive DOM.
- Advanced shape: native geometry.type or shapeExtrude/irregularGeometry; do not approximate all curved/custom shapes as boxes.
- Repeated city/forest/servers: instancedList or grouped subScene, not hundreds of unrelated root boxes.
`;

export {
  THREE_JSON_AGENT_CAPABILITY_INDEX,
  THREE_JSON_AGENT_CAPABILITY_INDEX_BASE,
  THREE_JSON_AGENT_ONLINE_TEXTURE_INDEX,
  buildAgentCapabilityIndex,
  THREE_JSON_AGENT_EXAMPLE_INDEX
};

/**
 * Compact ThreeJSON capability index for AI prompts.
 *
 * Keep this file concise: it is sent to LLMs more often than human docs. Longer explanations and
 * runnable examples stay in docs/ and assets/json/tutorial/.
 */
import { THREE_JSON_DOMAIN_CAPABILITY_INDEX } from "./sceneDomainCapability.js";
import { getSceneCapabilityManifest } from "../capabilities/sceneCapabilityManifest.js";

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
- Materials support standard/phong/lambert/basic fields, textureUrl/map, normal/roughness/metalness/emissive/alpha maps, repeat/offset/rotation/wrap/filter/anisotropy. Use only material types listed as available in the runtime capability snapshot below.
- sceneConfig.textureQuality controls default texture sampling; per-material textureSampling can override.
- assetLibrary can hold geometryPreset/materialPreset/shaderSource/eventScript and lib:// references.
- sceneConfig supports scene background/environment/fog, perspective or orthographic camera, orbit/firstPerson/fly controls, lights, helpers, renderLoop, available passList post-processing, intro.postLoad.

Effects and media:
- shaderSurface uses a registered shaderPreset for requested shader surfaces; particleEmitter is only for an effect/weather/particle field that is actually needed; particleList/points is the legacy point-cloud path.
- windList, heatList, weather domains, nature.sky, nature.water, sprites, tubes.
- audioList supports ambient or positional audio attached to scene/camera/object; use audioUrl and sensible playback policy fields.
- externalModelList/objModelList load GLTF/GLB/OBJ/STL/PLY/FBX/USD/USDZ assets; animationMode mixer and animationGraph support clip state machines where the format exposes clips.

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
- Core command mode supports scene.list, scene.validate, scene.applyPatch, scene.export, object.get/add/remove/patch/reconcile, material.patch, morph.list/set, camera.fit.
- Use commands for small edits and full JSON for broad restructuring. Use JSON Patch for minimal document-level edits when paths are clear.
`;

const THREE_JSON_AGENT_TEXTURE_ACQUISITION_INDEX = `
Texture acquisition:
- A separate host pipeline plans and acquires trusted texture resources after the scene is rendered. Scene authoring preserves supplied URLs but never invents URLs or bundled filenames. Express recognizable materials with accurate semantic names, base color, metalness, roughness, emissive properties, and textureRepeat so the later pipeline can choose an asset, trusted search result, PBR library, or capable generator.
`;

function buildAgentCapabilityIndex(options = {}) {
  const manifest = getSceneCapabilityManifest({
    rendererBackend: options.rendererBackend || "webgl",
    includePreview: options.includePreviewCapabilities === true
  });
  const list = (category) => Object.keys(manifest.categories?.[category] || {}).join(", ") || "none";
  const runtimeSnapshot = [
    "Runtime capability snapshot (author only these available capabilities):",
    `- renderer backend: ${options.rendererBackend || "webgl"}`,
    `- materials: ${list("materials")}`,
    `- light types: ${list("lightTypes")}`,
    `- post-processing passes: ${list("passes")}`,
    `- model formats: ${list("modelFormats")}`,
    `- particle simulations: ${list("particleBackends")}`,
    `- particle sources: ${list("particleSources")}`
  ].join("\n");
  return [
    THREE_JSON_AGENT_CAPABILITY_INDEX_BASE.trim(),
    runtimeSnapshot,
    THREE_JSON_AGENT_TEXTURE_ACQUISITION_INDEX.trim()
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
  THREE_JSON_AGENT_TEXTURE_ACQUISITION_INDEX,
  buildAgentCapabilityIndex,
  THREE_JSON_AGENT_EXAMPLE_INDEX
};

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
- Choose representation per semantic part, not once for the whole object. For example, a car's wheels/axles may be native primitives, but its characteristic curved body and cabin shell should normally be editableMesh/subdivision, loft/NURBS, or bufferMesh even when the request says only "a car" and does not add "complex" or "smooth".
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
- Complex geometry: full bufferMesh attributes/index/groups/morph targets; stable-ID editableMesh control topology with modifiers; parametricSurface, nurbsSurface, bezierPatch, latheMesh, loftMesh, sweepMesh, implicitSurface; shapePlane/shapeExtrude/irregular geometry and CSG.
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
- externalModelList/objModelList load GLTF/GLB/OBJ/STL/PLY/FBX/USD/USDZ assets; animationMode mixer and animationGraph support clip state machines where the format exposes clips. GLTF/GLB materialBindings can select loaded material slots and replace or patch them through the registered material factories.

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
- Core command mode supports scene.list/validate/applyPatch/export, object.get/add/remove/patch/reconcile, material.patch, morph.list/set, camera.fit, and mesh.inspect/getTopology/validate/edit/buffer.*/bake/renderViews.
- Use commands for small edits and full JSON for broad restructuring. Use JSON Patch for minimal document-level edits when paths are clear.
`;

const THREE_JSON_AGENT_TEXTURE_ACQUISITION_INDEX = `
Texture acquisition:
- A separate host pipeline plans and acquires trusted texture resources after the scene is rendered. Scene authoring preserves supplied URLs but never invents URLs or bundled filenames. Express recognizable materials with accurate semantic names, base color, metalness, roughness, emissive properties, and textureRepeat so the later pipeline can choose an asset, trusted search result, PBR library, or capable generator.
`;

// Intent negotiation needs capability *selection ids*, not the authoring grammar that the next
// model call will receive after selection. Keeping this view derived beside the full index avoids
// making a small classifier read thousands of irrelevant schema tokens before deciding whether
// the user even wants a new scene.
const THREE_JSON_AGENT_NEGOTIATION_INDEX_BASE = `
ThreeJSON capability-selection index (selection only; do not author scene JSON in this stage):

- Basic primitives, ordinary materials, camera, lighting, grouping, and common scene layout need no special capability id.
- sceneText — visible words/titles/labels; infoPanel — text or media on a visible board/card; css3dPanel — interactive DOM/iframe UI in 3D.
- group — multipart assemblies; instanced — many repeated objects; native — explicitly requested native Three.js geometry/ObjectLoader data.
- complexMesh — genuinely free-form/organic/detailed mesh authoring; editableMesh — stable-ID control topology; rawBufferMesh — explicit complete coordinates; subdivisionSurface — Catmull-Clark/Loop; parametricSurface — parametric/NURBS/Bezier/lathe/loft/sweep; implicitSurface — SDF/scalar-field surface; meshModeling — topology operations; meshMorph — morph targets.
- Select complexMesh from the subject's intrinsic silhouette as well as explicit adjectives. A car/automobile needs a curved body/cabin shell; regular subparts such as wheels may stay primitive. Direct scene generation and complex-mesh representation are independent choices.
- external — GLTF/GLB/OBJ/STL/PLY/FBX/USD/USDZ assets; audio — ambient/positional sound; shaderSurface — registered WebGL GLSL presets; postProcess — explicitly requested bloom/outline/FXAA/SMAA or registered pass presets.
- events — clicks/pointer/keyboard behavior; lifecycle — scene/object ready/dispose behavior; declarativeAnimation — continuous transform/expression animation; animationGraph — imported-model clip state machines.
- Select only ids whose detailed syntax/examples the authoring model actually needs. Do not select advanced capabilities for generic quality, realism, detail, or style wording.

${THREE_JSON_DOMAIN_CAPABILITY_INDEX.trim()}
`;

function buildAgentCapabilityIndex(options = {}) {
  const negotiationOnly = options.promptPurpose === "negotiation";
  const requestedRendererBackend = String(options.rendererBackend || "webgl").trim().toLowerCase();
  const isRendererNegotiation = requestedRendererBackend === "auto" || requestedRendererBackend === "any";
  const manifest = getSceneCapabilityManifest({
    // Negotiation needs to see every backend the host has actually registered. Authoring calls
    // still pass one concrete backend so the generation model cannot mix WebGL-only and
    // WebGPU-only records in the same scene by accident.
    rendererBackend: isRendererNegotiation ? undefined : requestedRendererBackend,
    includePreview: options.includePreviewCapabilities === true
  });
  const activatableEntries = new Set(
    Array.isArray(options.activatableCapabilityEntries)
      ? options.activatableCapabilityEntries.map((entry) => String(entry || "").trim()).filter(Boolean)
      : []
  );
  if (activatableEntries.size > 0) {
    const declared = getSceneCapabilityManifest({
      rendererBackend: isRendererNegotiation ? undefined : requestedRendererBackend,
      includePreview: true,
      includeUnavailable: true
    });
    for (const [categoryId, category] of Object.entries(declared.categories || {})) {
      manifest.categories[categoryId] ||= {};
      for (const [capabilityId, capability] of Object.entries(category || {})) {
        const declaredEntries = [
          capability?.entry,
          ...(Array.isArray(capability?.optionalEntries) ? capability.optionalEntries : [])
        ].map((entry) => String(entry || "").trim()).filter(Boolean);
        if (
          capability?.status === "unavailable"
          && declaredEntries.some((entry) => activatableEntries.has(entry))
        ) {
          const promoted = {
            ...capability,
            status: "activatable",
            activation: "host-import"
          };
          if (
            categoryId === "materials"
            && capabilityId === "tsl"
            && activatableEntries.has(String(capability.codeEntry || ""))
          ) {
            promoted.modes = [...new Set([...(capability.modes || []), "code"])];
            promoted.codeExecutionPolicy = options.activatableTslCodePolicy || "prompt";
          }
          manifest.categories[categoryId][capabilityId] = promoted;
        }
      }
    }
  }
  const list = (category) => Object.keys(manifest.categories?.[category] || {}).join(", ") || "none";
  const runtimeSnapshot = [
    isRendererNegotiation
      ? "Host capability snapshot for negotiation (choose one compatible renderer backend; do not mix backend-specific features):"
      : "Runtime capability snapshot (author only these available capabilities):",
    isRendererNegotiation
      ? `- available renderer backends: ${list("rendererBackends")}`
      : `- renderer backend: ${requestedRendererBackend}`,
    `- materials: ${list("materials")}`,
    `- objects: ${list("objects")}`,
    `- light types: ${list("lightTypes")}`,
    `- post-processing passes: ${list("passes")}`,
    `- model formats: ${list("modelFormats")}`,
    `- particle simulations: ${list("particleBackends")}`,
    `- particle sources: ${list("particleSources")}`
  ].join("\n");
  const tslCapability = manifest.categories?.materials?.tsl;
  const tslAvailable = Boolean(tslCapability);
  const tslNeedsActivation = tslCapability?.status === "activatable";
  const tslModes = Array.isArray(tslCapability?.modes) ? tslCapability.modes : [];
  const tslKindContract = tslModes.map((mode) => `"${mode}"`).join("|") || "none";
  const tslCodeGuidance = tslModes.includes("code")
    ? "- kind:\"code\" is available because the host imported or can activate the tsl-code entry; scene JSON still cannot enable or relax the selected host execution policy."
    : "- kind:\"code\" is not available in this runtime snapshot. The host must explicitly import the tsl-code entry before AI may author code modules.";
  const tslAuthoring = !tslAvailable ? "" : negotiationOnly ? `
WebGPU/TSL authoring capability (negotiation ids: webgpuTsl, tslCode):
- ${tslNeedsActivation ? "The host can activate WebGPU/TSL on demand after selection; ordinary WebGL scenes do not load it." : "WebGPU/TSL is active in this host snapshot."}
- Select webgpuTsl only for explicit TSL, NodeMaterial, WebGPU node graphs/shaders, or a procedural animated surface that genuinely needs TSL. Do not select it for ordinary PBR materials, textures, colors, or generic high-quality wording.
- Available TSL kinds: ${tslKindContract}. The selected scene must use the WebGPU renderer.
${tslCodeGuidance}
${tslModes.includes("code") ? '- Select tslCode in addition to webgpuTsl only when a full executable TSL ESM module is genuinely required; preset/graph remain preferred when sufficient. The host owns confirmation/execution policy.' : ''}
` : `
WebGPU/TSL authoring capability (negotiation ids: webgpuTsl, tslCode):
- ${tslNeedsActivation ? "This host offers the capability on demand and will import the appropriate threejson/webgpu or threejson/tsl-code entry after selection; ordinary WebGL scenes do not pay the module cost." : "The WebGPU/TSL entry is active in this runtime snapshot."}
- Select webgpuTsl when the user explicitly asks for TSL, NodeMaterial, WebGPU shader/node graphs, or when a requested procedural surface effect genuinely needs a time-varying node graph. Do not select it for ordinary colors, PBR textures, or generic "high quality" wording.
- Set sceneConfig.renderer.backend to "webgpu". revisionPolicy is "best-effort" by default; use "strict" only when the host requires the tested Three.js revision.
- TSL materials use material { type:"tsl", base:"standard"|"physical"|"basic"|"lambert"|"phong"|"toon"|"matcap"|"normal", tsl:{ kind:${tslKindContract}, ... } }.
- Prefer preset or graph for portable generated scenes. Preset uses tsl:{kind:"preset",preset:"solid"|"uv-gradient"|"pulse",params:{...}}.
- Graph uses tsl:{kind:"graph",source:{inline:{graphVersion:1,nodes:[{id,type,...}],outputs:{color:"nodeId",opacity?:"nodeId",position?:"nodeId"}}}}. Node references are node id strings. Compose effects such as burn/dissolve from position/time/noise/fractalNoise/math/mix/smoothstep nodes instead of assuming a one-off preset; call may use callable three/tsl exports.
- To apply TSL to a GLTF/GLB asset, add materialBindings:[{ selector:{ nodeName|nodePath|nodeType|meshIndex|materialName|materialIndex }, inheritOriginal?:"textures"|"all", material:{ type:"tsl", ... } }]. An empty selector or {all:true} targets all slots.
${tslCodeGuidance}
${tslModes.includes("code") ? '- Select tslCode in addition to webgpuTsl only when the requested effect genuinely needs a full TSL ESM module rather than a preset/graph. Code shape: tsl:{kind:"code",source:{inline:"export default (params, context) => ..."}|{url:"...",sha256?:"..."},params:{...}}. Inline source must be one valid JSON string and default-export a factory returning a NodeMaterial, TSL node, output-node map, or undefined after mutating context.material. Use context.TSL/context.WEBGPU; do not invent module URLs or a sha256 value. The host, not scene JSON, owns confirmation/execution policy.' : ''}
`;
  const particleAuthoring = options.particleEffects === false ? "" : negotiationOnly ? `
Particle V2 capability ids:
- particles — requested particles, point clouds, rain/snow, smoke/fire/sparks/fireworks, dust/starfields, attractors, or particle patterns.
- particleRaster — additionally select for particles forming text, a logo, image, or mask through textMask/imageMask; never substitute an instanced cube grid.
- webgpuParticles — additionally select only for explicit WebGPU/GPU-compute particles or a scale/simulation that genuinely benefits from WebGPU compute.
- Host particle sources: ${list("particleSources")}. Host simulation backends: ${list("particleBackends")}.
` : `
Particle V2 capability ids:
- particles: select for requested particles, point clouds, rain/snow, smoke, fire, sparks, fireworks, dust, starfields, magic effects, attractors, or particle patterns. Author objType:"particleEmitter" with five orthogonal blocks: source, emission, particle, simulation, render. Do not use retired top-level count/distribution/motion/material fields.
- particleRaster: additionally select for textMask or imageMask particle patterns. Those sources are descriptor-activated browser capabilities; textMask uses text/font/width/height/depth and imageMask uses url or image data. Never substitute a cube grid for requested particle text or imagery.
- webgpuParticles: select only when WebGPU compute is available and the requested particle count/simulation materially benefits from it. It requires sceneConfig.renderer.backend:"webgpu" and simulation.backend:"webgpu-compute"; ordinary particle effects may use cpu or webgl-compute.
- Available sources in this host snapshot: ${list("particleSources")}. Available simulation backends: ${list("particleBackends")}.
- emission supports static|continuous|burst with count/rate/duration/loop/seed; particle supports lifetime, velocity/rotation ranges, and size/color/opacity-over-life; simulation supports gravity, drag, noise, attractors, and none|wrap|bounce|kill boundaries; render supports points or billboard plus sprite/atlas fields.
`;
  const complexCapabilityIds = new Set([
    "complexMesh", "editableMesh", "rawBufferMesh", "subdivisionSurface",
    "parametricSurface", "implicitSurface", "meshModeling", "meshMorph"
  ]);
  const complexSelected = Array.isArray(options.selectedCapabilityIds)
    && options.selectedCapabilityIds.some((id) => complexCapabilityIds.has(id));
  const complexMeshAuthoring = negotiationOnly ? `
Complex-model capability ids:
- complexMesh — a genuinely free-form, organic, smooth, or detailed mesh that primitives cannot faithfully represent.
- editableMesh — stable-ID low-density control topology suitable for progressive local refinement.
- rawBufferMesh — user explicitly wants complete vertices/indices/attributes or BufferGeometry.
- subdivisionSurface — Catmull-Clark/Loop subdivision of a control cage.
- parametricSurface — parametric, NURBS, Bezier patch, lathe, loft, or sweep representation.
- implicitSurface — SDF/scalar-field isosurface.
- meshModeling — vertex/face topology operations such as extrude, inset, bevel, bridge and loop cut.
- meshMorph — morph targets/blend shapes.
- Generic requests for quality alone do not force complexMesh. Prefer primitives, native parametric geometry, instancing, or CSG whenever they faithfully express the final shape; select complexMesh only for irregular silhouette, free-form curvature, topology, morphing, or local surface detail those representations cannot express.
- A clearly free-form requested object must not be downgraded to primitive blocks merely to shorten output. Its first draft should normally be a recognizable low-density editable surface that remains the control source, not disposable primitive scaffolding.
- Mixed representation is preferred when accurate: for a car, author the body/cabin silhouette with editableMesh/subdivision, loft/NURBS, or raw bufferMesh, while using cylinders/torus/native geometry for wheels and other genuinely regular parts. Do not represent the entire vehicle as a pile of boxes merely because the user did not explicitly say "complex mesh".
` : complexSelected ? `
Native complex-model authoring (selected capability ids include a complex-mesh feature):
- Choose representation by shape, not by output convenience. Use primitives only for truly regular parts. A free-form model must use editableMesh, a compact surface/SDF descriptor, or raw bufferMesh; an external asset is optional and never a substitute for native expression.
- Treat a recognizable curved product/vehicle/character/animal shell as free-form even when the user names only the object. For a car, keep wheels and axles regular if appropriate but make the main body and cabin a continuous curved surface rather than stacked boxes.
- editableMesh record: {threeJsonId,objType:"editableMesh",topology:{revision:0,vertices:[{id,position:[x,y,z],attributes?}],faces:[{id,vertices:[stableIds...],part,materialIndex,smooth}],edges:[{vertices:[id,id],crease:0..1}]},modifiers:[...],materials:[...]}. Faces may be triangles, quads, or n-gons. Preserve stable IDs and semantic part names.
- Modifiers currently evaluated in core: mirror, catmullClark/subdivision, loopSubdivision, smooth, creaseNormal, edgeSplit, bevel, solidify, triangulate, tessellate, simplify, planar/box/cylindrical/spherical/triplanar UV projection, and normal/tangent recomputation. The control topology remains the JSON source.
- Progressive editing: first mesh.inspect, then mesh.getTopology filtered by part/IDs/bounds/page when needed; issue one atomic mesh.edit {id,baseRevision,operations:[...]}; validate with mesh.validate. Operations: add/set/remove vertex/face, assignPart, setEdgeCrease, extrudeFaces, insetFaces, bevelEdges, bridgeLoops, loopCut, mirror, setModifier, setModifiers, reorderModifier. Never repeat the whole dense mesh in each round.
- Local refinement: when silhouette/topology are already correct and only smoothness or evaluated density is lacking, use setModifier for Catmull-Clark on quad/n-gon cages or Loop on triangle cages, optionally followed by Smooth. Modifier evaluation uses local compute and preserves the low-density JSON control topology; do not ask the model to generate redundant vertices.
- raw bufferMesh record: geometry.attributes maps arbitrary BufferAttribute names to {array,itemSize,type,normalized?}; geometry.index supports Uint16Array or Uint32Array; groups, drawRange, morphAttributes and morphTargetsRelative are supported. The compact positions/indices/normals/uvs shorthand remains valid. There is no ThreeJSON vertex/triangle/JSON-size limit; only actual invalid data or an explicitly supplied host meshBudget may reject it.
- Large raw output can use mesh.buffer.appendAttribute/setAttributeRange/appendIndices/setIndexRange and ends with mesh.buffer.commit. Continue exact JSON/mesh transactions until complete; do not substitute a representative primitive because the response is long. If the user explicitly chose full coordinates, honor it.
- Compact surfaces: parametricSurface geometry {expressions:{x,y,z},uRange,vRange,uSegments,vSegments}; nurbsSurface {controlPoints,degreeU,degreeV,knotsU?,knotsV?,uSegments,vSegments}; bezierPatch {controlPoints,uSegments,vSegments}; latheMesh {profile,segments}; loftMesh {sections}; sweepMesh {profile,path,segments}; implicitSurface {bounds,resolution,isoLevel,sdf} where SDF nodes include sphere/box/torus/capsule/union/intersection/subtract/smoothUnion/expression.
- Morphs: bufferMesh geometry.morphAttributes.position/normal arrays plus morphTargetsRelative and record.morphInfluences. Existing loaded morphs use morph.list/morph.set.
- For a complex-model draft, create a recognizable low-density silhouette with complete main parts and a subdivision modifier, render it immediately, then refine concrete semantic parts. End with # done only when the selected quality target is met; use # continue: <specific remaining part> only when more work is genuinely needed.
` : "";
  return [
    (negotiationOnly
      ? THREE_JSON_AGENT_NEGOTIATION_INDEX_BASE
      : THREE_JSON_AGENT_CAPABILITY_INDEX_BASE).trim(),
    runtimeSnapshot,
    complexMeshAuthoring.trim(),
    particleAuthoring.trim(),
    tslAuthoring.trim(),
    negotiationOnly ? "" : THREE_JSON_AGENT_TEXTURE_ACQUISITION_INDEX.trim()
  ].filter(Boolean).join("\n\n");
}

const THREE_JSON_AGENT_CAPABILITY_INDEX = buildAgentCapabilityIndex();

const THREE_JSON_AGENT_EXAMPLE_INDEX = `
Capability patterns:
- Domain object: objectList item with objType domain + domain + handler + payload/items/options.
- Interactive object: add events.click.actions with object.toggleVisible / object.moveBy, or events.click.script for short EventScript.
- Lifecycle intro/spawn: use sceneConfig.intro.postLoad for a splash; use events["object.ready"] for finite per-object creation motion. Use declarative per-frame animation for continuous motion.
- Animated imported model: externalModel with animationMode "mixer", renderLoop.updateAnimations true, and animationGraph { parameters, states, transitions }.
- Imported-model material override: GLTF/GLB externalModel with materialBindings selecting node/material slots and a registered replacement material; use a TSL replacement only when the runtime snapshot exposes TSL.
- Dashboard: stat domain records for charts + infoPanel for static labels + css3dPanel only for interactive DOM.
- Advanced shape: native geometry.type or shapeExtrude/irregularGeometry; do not approximate all curved/custom shapes as boxes.
- Repeated city/forest/servers: instancedList or grouped subScene, not hundreds of unrelated root boxes.
`;

export {
  THREE_JSON_AGENT_CAPABILITY_INDEX,
  THREE_JSON_AGENT_CAPABILITY_INDEX_BASE,
  THREE_JSON_AGENT_NEGOTIATION_INDEX_BASE,
  THREE_JSON_AGENT_TEXTURE_ACQUISITION_INDEX,
  buildAgentCapabilityIndex,
  THREE_JSON_AGENT_EXAMPLE_INDEX
};

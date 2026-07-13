/**
 * ThreeJSON scene AI prompt assembly. English constants below are sent to LLMs to keep JSON field compatibility;
 * do not switch them to Chinese without re-validating model output quality.
 */
import {
  THREE_JSON_AGENT_CAPABILITY_INDEX,
  THREE_JSON_AGENT_EXAMPLE_INDEX
} from "./sceneCapabilityIndex.js";

const THREE_JSON_LIST_PLACEMENT = `
Where to put objects (friendly worldInfo lists — pick the list that matches the shape/role):

Capability fit:
- This catalog is descriptive, not a checklist. Use only the lists needed by the prompt or existing scene.
- Keep simple scenes simple. Do not add decorative lines, particles, shaders, native meshes, domains, audio, events, or lifecycle scripts unless they correspond to a requested or clearly implied element.
- "Needed" includes implied support surfaces: rooms, buildings, campuses, streets, gardens, factories, exhibits, furniture layouts, and game levels normally need a floor/ground/base even if the prompt does not explicitly say "floor".
- Normal scenes should not receive particleEmitter by default. Add particles only for explicit or clearly implied particle/weather/atmospheric effects such as rain, snow, dust, sparks, smoke, magic, or starfields.

Primary meshes:
- boxModelList — box, floor, wall, glass, cabinet, door, road and other box-like presets; also mixed meshList when objType is explicit per item
- sphereModelList — spheres (objType may be omitted; list implies sphere)
- modelList — cylinder, cone, torus, ring, capsule and other deployMesh primitives (always set objType per item)

Structure & overlay:
- groupList — nested assemblies (children in subScene[] on each group; optional top-level subSceneList blocks for layout)
- lineList — polylines for visible paths, roads-as-lines, cables, routes, boundaries, or outlines (points[], topology line|lineSegments|lineLoop)
- infoPanelList — static signage (text/html/img baked to texture; panelBoxType box|sprite|plane)
- css3dPanelList — interactive DOM panels (buttons, forms, iframe); requires host CSS3D pass at runtime
- planeList, shapePlaneList, irregularPlaneList, bufferMeshList, shapeExtrudeList, irregularGeometryList
- shaderSurfaceList — custom shader surfaces (objType shaderSurface)

Effects & visualization:
- Prefer objType particleEmitter (objectList or any friendly list) only for requested/implied particles, rain, snow, dust, sparks, starfields, or similar atmospheric effects — simulation cpu|gpuCompute
- particleList — legacy points clouds (objType points); prefer particleEmitter for new scenes
- windList, heatList — wind strips / heat volumes
- spriteList, tubeList, instancedList
- objectList — scene text (objType text): floating labels, SDF titles; may also hold particleEmitter, css3dPanel, domain records in standard JSON when those roles are actually needed

Assets & domains:
- externalModelList / objModelList — GLTF/OBJ paths
- domainModelList — domain handlers (weather rain|snow, nativeThree loadFromUrl, wall addToScene, etc.)
- audioList — positional or ambient audio

Runtime (top-level sceneConfig — preferred for new standard JSON and friendly JSON):
- sceneConfig: { scene, camera, renderer, controls, lights[], renderLoop, helpers, extensions, textureQuality? }
- textureQuality: 0|1|2|3 or off|low|medium|high (optional global texture sampling tier; omit unless user asks)
- extensions: JSON container only — e.g. nativeGeometries[], assetLibrary.textureUrlCache; physics/plugins are host bootstrap (not auto-loaded)
- camera supports type "perspective" (default) or "orthographic"/"ortho"; lookAt {x,y,z} is supported
- controls supports type "orbit" (default), "firstPerson", "fly"
- helpers: { grid: boolean, axes: boolean } or gridHelper / axesHelper sugar on sceneConfig or worldInfo
- Optional customBucket on objects for host batch queries (runtime index tag; not a scene graph node)

Standard JSON (scheme B — recommended for editor/API/AI when not using friendly lists):
- threeJsonId (required document identity; no worldId)
- sceneConfig for primary viewport runtime (camera, lights, controls, …)
- objectList for deployable objType instances (box, line, domain, extra cameras/lights, …)
- jsonOrigin on camera|light|controls: "config" when in sceneConfig, "list" when in objectList (round-trip hint only)

Standard alternative (still valid): all objTypes in a single top-level objectList including scene|camera|renderer|controls|light|renderLoop|box|…
`;

const THREE_JSON_PRIMITIVE_GEOMETRY = `
Primitive geometry fields (use in modelList / sphereModelList / boxModelList as appropriate):

box | floor | wall | glass | cabinet | door:
  geometry: { "width", "height", "depth" }

sphere (sphereModelList or objType sphere):
  geometry: { "radius", "widthSegments", "heightSegments" }

cylinder (modelList, objType cylinder):
  geometry: { "radiusTop", "radiusBottom", "height", "radialSegments" }

cone (modelList, objType cone):
  geometry: { "radius", "height", "radialSegments" }

torus (modelList, objType torus):
  geometry: { "radius", "tube", "radialSegments", "tubularSegments" }

ring (modelList, objType ring):
  geometry: { "innerRadius", "outerRadius", "thetaSegments" }

capsule (modelList, objType capsule):
  geometry: { "radius", "length", "capSegments", "radialSegments" }

Never use geometry field "length" for boxes — use width/height/depth. Capsule uses "length" for the cylindrical mid section.
`;

const THREE_JSON_NATIVE_THREE = `
Native Three.js objects (any Three.js BufferGeometry + Material the engine supports):

Friendly or objectList entry patterns:
1) objType "native" with threeType "Mesh"|"Group" and geometry.type e.g. "TorusKnotGeometry", "LatheGeometry", "DodecahedronGeometry"
2) Custom objType string + geometry.type — engine auto-dispatches via parseMode "auto" (default)
3) parseMode "native" on any entry — forces ObjectLoader-style parsing, skipping specialized box/sphere handlers
4) jsm geometry alias: objType "roundedBox" maps to geometry.type "RoundedBoxGeometry" (declare it in sceneConfig.extensions.nativeGeometries)
5) explicit reusable assets: geometryRef/materialRef can reference assetLibrary geometryPreset/materialPreset via lib:// ids

Example (objectList or modelList item):
{
  "name": "knot",
  "objType": "native",
  "geometry": { "type": "TorusKnotGeometry", "radius": 4, "tube": 1.1, "tubularSegments": 128, "radialSegments": 16, "p": 2, "q": 3 },
  "material": { "type": "MeshStandardMaterial", "color": "#88aaff", "metalness": 0.3, "roughness": 0.5 },
  "position": { "x": 0, "y": 5, "z": 0 }
}

domainModelList for full subgraph JSON:
{ "objType": "domain", "domain": "nativeThree", "handler": "loadFromUrl", "modelPath": "/assets/json/three_native.json" }
`;

const THREE_JSON_DOMAIN_USAGE = `
Domain records (business objects; use these instead of hand-building boxes when the user asks for a built-in domain object):

Where:
- Friendly JSON: worldInfo.domainModelList: [{ "objType": "domain", "domain": string, "handler": string, ... }]
- Standard JSON: objectList: [{ "objType": "domain", "domain": string, "handler": string, ... }]

Rules:
- A domain record is a dispatcher input. It should name the domain and handler, then pass domain-specific payload/items/options/geometry/material fields.
- Do NOT put plain objType "box" records in domainModelList. Boxes belong in boxModelList/objectList; domainModelList records use objType "domain" (or omit objType in friendly form).
- For business concepts, prefer the domain factory/preset over approximating everything with boxes.
- Keep domain ids qualified when needed: weather.rain, nature.sky, nature.water, stat.bar, stat.grid, stat.panel, stat.line, stat.pie, stat.ring, device.cabinet, port.

Common patterns:
- Device cabinet/rack:
  { "objType":"domain", "domain":"device.cabinet", "handler":"createCabinet", "payload": { "name":"rack-a", "label":"Rack A", "position": { "x":0, "y":0, "z":0 } } }
- Stat bars/dashboard:
  { "objType":"domain", "domain":"stat.bar", "handler":"createStatBars", "items":[ { "name":"cpu", "value":72, "max":100, "label":"CPU", "position":{ "x":-10, "y":0, "z":0 } } ] }
- Nature sky/water:
  { "domain":"nature.sky", "handler":"sunset", "geometry": { "radius":350 }, "uniforms": { "sunDirection":[-0.62,0.32,-0.68] } }
  { "domain":"nature.water", "handler":"ocean", "geometry": { "width":400, "height":400 }, "position": { "x":0, "y":0, "z":0 } }
- Weather:
  { "objType":"domain", "domain":"weather", "handler":"rain", "name":"rain-zone", "position": { "x":0, "y":8, "z":0 }, "count":1200 }
- Port:
  { "objType":"domain", "domain":"port", "handler":"dockCrane", "name":"dock-crane", "geometry": { "width":70, "length":90, "height":280, "depth":90 }, "position": { "x":-80, "y":2, "z":-250 } }
`;

const THREE_JSON_INTENT_GUIDE = `
Match user intent to engine features (use boxes when they are the right abstraction — e.g. furniture, crates, blockout):

Appropriateness rule:
- Choose features because they represent the scene, not because they are available. A simple building, room, shelf, table, or blockout normally needs boxes/floors/walls plus maybe labels/lights, not particles or decorative lineList.
- Do include an unobtrusive support surface for grounded physical scenes: a floor for rooms/interiors, terrain/ground for outdoor layouts, a road/slab for streets/campuses/factories, or a plinth/base for exhibits. Do not add one for space scenes, floating diagrams, abstract sculptures, or explicitly suspended objects.
- Do not add particleEmitter as generic ambiance. Use it only when the scene specifically contains visible particles, weather, smoke, magic, dust, sparks, or a starfield.
- For edit requests, preserve all unspecified properties. Example: "make the blue building taller" should increase only height and adjust y/position if needed; do not change width, depth, color, or replace the object type.

Intent → capability:
- Ground / slab → objType floor (boxModelList or floorList)
- Implied support surface for room/building/campus/street/garden/factory/exhibit/furniture/game-level scenes → objType floor or road/base slab sized to contain the layout
- Walls / facades / fences → objType wall or domainModelList domain wall
- Windows / glass panels → objType glass + glassKind clear|tinted|frosted
- Spheres / planets / balls → sphereModelList with geometry.radius
- Columns / pipes → modelList objType cylinder
- Cones / pyramids → modelList objType cone
- Donuts / rings (3D) → modelList objType torus or ring
- Roads / cables / boundaries → lineList with points[]
- Signs / HUD with panel backing (text/html/img) → infoPanelList (static texture; not clickable)
- Interactive console / form / iframe overlay → css3dPanelList (objType css3dPanel)
- Floating 3D labels / floor titles / extruded titles → objectList objType text (mode sdf|texture|mesh)
- Multi-part buildings / rigs → groupList with subScene[] children (or subSceneList blocks)
- Particles / stars / dust / sparks → objectList or modelList objType particleEmitter (simulation cpu|gpuCompute)
- Rain / snow → domainModelList domain weather.* or objType particleEmitter with weather-style material
- Custom animated shader plane → shaderSurfaceList (objType shaderSurface)
- Pipes along paths → tubeList + path catmullRom
- Many repeated props → instancedList + transforms[]
- Complex Three.js shapes → native dispatch (TorusKnot, Lathe, Polyhedron, etc.)
- GLTF/OBJ assets → externalModelList / objModelList
- Boolean cuts on boxes → holes / joins / inters on boxModelList items (CSG)
- Scene atmosphere → sceneConfig scene.background, lights; optional windList / heatList only when wind/heat is actually visible or requested
`;

const THREE_JSON_SCENE_AUTHORING_RULES = `
Scene authoring rules:
1. Choose the objType and worldInfo list that most faithfully and specifically matches the user's described shapes and roles — prefer the most fitting capability (native geometry, domain record, or specialized objType) over a generic primitive stand-in whenever it represents the object better; use basic geometry when it genuinely is the best fit (a plain box/blockout was asked for, or no more specific capability applies), not merely because it's simpler to emit.
2. Put each object in the correct list (lines in lineList, static panels in infoPanelList, interactive DOM in css3dPanelList, scene text in objectList with objType text, groups in groupList, cylinders in modelList, spheres in sphereModelList, etc.).
3. Use descriptor **name** for batch/page semantics (e.g. "room-wall", "air-conditioning"); use **label** for display text; do not invent unsupported objType strings like "container" or "ground" — use floor/wall/glass instead.
4. Friendly JSON: worldInfo.boxModelList must exist as an array (may be [] when other lists carry all content). Standard JSON: use objectList (and sceneConfig for primary runtime) instead of worldInfo.
5. Prefer friendly worldInfo + sceneConfig OR standard scheme B (sceneConfig + objectList + threeJsonId). Include reasonable camera, lights, and controls in sceneConfig for standalone scenes.
6. Always set top-level threeJsonId (stable string or UUID). Do not use worldId or worldInfo.id.
7. Do not embed page UI or alarmList in scene JSON.
8. Optional declarative animation on meshes: "animations": [{ "type": "rotate", "axis": "x"|"y"|"z", "speed": number }]
9. Never add decorative lineList, particleEmitter, shaderSurface, native geometry, domains, audio, events, or lifecycle scripts merely to use more capabilities; every non-basic capability must map to a requested or clearly implied scene element.
10. For edits and patches, preserve unspecified geometry/material/position fields. When changing box height, keep width/depth unchanged and update y only if needed to keep the base on the same ground.
11. New grounded physical scenes should usually include exactly one unobtrusive support surface (floor/ground/road/slab/plinth) sized to the layout unless the prompt describes a floating, space, abstract, or supportless scene.
12. URL-bearing fields (material.textureUrl, externalModel modelPath, audioUrl, css3dPanel url, text mesh fontJsonUrl, etc.) may be a full https:// URL — a real public image/model/audio/page online is valid and often exactly what the user wants, not just a repo-local path. When the user gives or implies a specific URL, use it verbatim. During repair/review/patch passes, never replace an existing valid URL (local or remote) with an invented placeholder path just to "normalize" it — only change a URL when the user's request calls for a different one.
13. When the user names a specific, recognizable real-world object or material — a named celestial body (Moon, Earth, Mars, Sun...), a specific wood/stone/fabric/brand pattern, etc. — as opposed to a generic/abstract shape, actively set material.textureUrl to a real, appropriate public https:// image depicting that specific subject instead of leaving a flat color; this is expected default behavior for well-known named referents, not something to wait for the user to ask for explicitly. Known-good anchors: Moon → https://threejs.org/examples/textures/planets/moon_1024.jpg ; Earth → https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg — use the same reasoning (a real, likely-stable public image URL depicting that exact subject) for other named bodies/materials. Do not force a textureUrl onto generic/abstract shapes (plain boxes, blockouts, furniture placeholders) where a flat color already satisfies the request (see rule 1).
14. Light intensity is on TWO DIFFERENT SCALES depending on type — using the wrong scale is the single most common cause of "geometry is correct but the scene renders pitch black": intensity values are used exactly as written, with NO automatic rescaling by the engine.
    - ambient/directional lights are NOT distance-attenuated: use small values, typically 0.4-1.3 (e.g. ambient 0.4-0.6, directional 0.8-1.3). This is the range you see in most reference scenes.
    - point/spot lights ARE distance-attenuated by inverse-square falloff ("decay" defaults to 2, i.e. physically correct) — at typical scene distances (a few meters to tens of meters) they need intensity roughly one to two orders of magnitude larger than ambient/directional, e.g. 20-60 for a light a few meters from what it's illuminating; use "unit":"candela" with a value like 2000-20000 if you want it explicitly photometric. NEVER give a point/spot light an intensity in the 0.4-1.3 range meant for ambient/directional — it will be effectively invisible.
    - Default to ambient + directional for a scene's general illumination (reliable, simple); only add point/spot lights for localized effects (a lamp, a glowing object, a spotlight beam), and always give them intensity in the tens-or-higher range above, never the ambient/directional range.
    - Every standalone/new scene should include at least one ambient and one directional light unless the user's request clearly implies otherwise (e.g. "in total darkness except for one lamp"). A good default is ambient 0.45-0.65 plus directional 0.9-1.2 from above/front/side.
15. Particle emitters are opt-in effects, not default scene dressing. Do not include particleEmitter/particleList unless the prompt or reference clearly calls for particles/weather/smoke/magic/dust/sparks/starfield.
`;

const THREE_JSON_SCENE_SCHEMA_DESCRIPTION = `
ThreeJSON scene data schema (friendly form — preferred for AI output):
{
  "version": "next",
  "name": string,
  "sceneConfig": {
    "scene": { "background": "#RRGGBB" },
    "camera": { "fov": number, "near": number, "far": number, "position": { "x", "y", "z" } },
    "renderer": { "antialias": boolean },
    "controls": { "enableDamping": boolean, "target": { "x", "y", "z" } },
    "lights": [{ "type": "ambient"|"directional"|"point"|"spot", "color": "#RRGGBB", "intensity": number, "position": { "x", "y", "z" } (ignored for ambient), "distance": number (optional, point|spot; 0 = unbounded), "decay": number (optional, point|spot; default 2 = physically correct inverse-square falloff), "angle": number (optional, spot only, radians), "penumbra": number (optional, spot only, 0-1), "target": { "x", "y", "z" } (optional, spot only) }] — see authoring rule 14 for intensity scale (point/spot need MUCH higher values than ambient/directional),
    "renderLoop": { "autoResize": boolean },
    "helpers": { "grid": boolean, "axes": boolean },
    "textureQuality": "off"|"low"|"medium"|"high" or 0|1|2|3 (optional),
    "extensions": { "nativeGeometries"?: string[], "assetLibrary"?: { "textureUrlCache"?: boolean }, ... } (optional),
    "textFont": { "fontUrl": string|null, "preloadCharacters": string } (optional, SDF text defaults)
  },
  "threeJsonId": string,
  "worldInfo": {
    "boxModelList": [MeshRecord, ...],
    "sphereModelList": [MeshRecord, ...],
    "modelList": [MeshRecord, ...],
    "groupList": [GroupRecord, ...],
    "lineList": [LineRecord, ...],
    "infoPanelList": [InfoPanelRecord, ...],
    "css3dPanelList": [Css3dPanelRecord, ...],
    "shaderSurfaceList": [ShaderSurfaceRecord, ...],
    "particleList": [PointsItem, ...],
    "tubeList": [TubeItem, ...],
    "spriteList": [SpriteItem, ...],
    "instancedList": [InstancedItem, ...],
    "windList": [...],
    "heatList": [...],
    "audioList": [AudioItem, ...],
    "domainModelList": [...],
    "externalModelList": [...]
  }
}

MeshRecord:
{
  "name": string,
  "objType": string,
  "glassKind": "clear"|"tinted"|"frosted" (when objType is glass),
  "geometry": { ... see primitive geometry table ... },
  "position": { "x", "y", "z" },
  "rotation": { "rotationX", "rotationY", "rotationZ" } (optional),
  "scale": { "scaleX", "scaleY", "scaleZ" } (optional),
  "material": {
    "type": "standard"|"phong"|"lambert"|"basic"|"dynamicBox",
    "color": "#RRGGBB",
    "opacity": number,
    "transparent": boolean,
    "textureUrl": string (optional; local path or full https:// URL — see authoring rule 12),
    "metalness": number (optional),
    "roughness": number (optional)
  },
  "geometryRef": "lib://geometry-id" (optional),
  "materialRef": "lib://material-id" (optional),
  "geometryOverrides": { ... } (optional),
  "materialOverrides": { ... } (optional),
  "sharePolicy": { "geometry": "clone"|"shared", "material": "clone"|"shared" } (optional),
  "animations": [{ "type": "rotate", "axis": "y", "speed": number }] (optional),
  "joins"|"inters"|"holes": [MeshRecord] (optional CSG)
}

GroupRecord, LineRecord, InfoPanelRecord, Css3dPanelRecord, ShaderSurfaceRecord, PointsItem, AudioItem — same shapes as before.
Css3dPanelRecord: { "objType": "css3dPanel", "html": string or "url": string, "panel": { "position", "geometry": { width, height, depth } } } — host must enable CSS3D rendering.
ShaderSurfaceRecord: { "objType": "shaderSurface", "shaderSource" or material with ShaderMaterial, "geometry": plane/box dims, "position": {...} }
ParticleEmitterItem: { "objType": "particleEmitter", "simulation": "cpu"|"gpuCompute", "material": { "size", "opacity", "color" }, "position": {...} }
TextItem (objectList only): { "objType": "text", "content": string, "mode": "sdf"|"texture"|"mesh", "fontSize": number, "color": "#RRGGBB", "align": "left"|"center"|"right", "billboard": boolean, "position": {x,y,z}, "mesh": { "fontJsonUrl": string } when mode is mesh }
TubeItem: { "objType": "tube", "path": { "type": "catmullRom", "points": [{x,y,z},...] }, "geometry": { "radius", "tubularSegments" }, "material": {...} }
InstancedItem: { "objType": "instanced", "geometry": { "width", "height", "depth" }, "transforms": [{ "position", "rotation", "scale" }] }

Compatibility: valid JSON only; finite numbers; material.color as #RRGGBB; floor/wall/glass via objType not material.type.
Rotations: use numeric radians (1.5708), never Math.PI or arithmetic expressions inside JSON.

Standard JSON scheme B (alternative to friendly form):
{
  "version": "next",
  "name": string,
  "threeJsonId": string,
  "sceneConfig": { scene, camera, controls, lights[], renderLoop, helpers?, extensions? },
  "objectList": [ { "objType": string, ... }, ... ],
  "assetLibrary"?: [...],
  "extensions"?: { ... }
}
`;

const THREE_JSON_CORE_CAPABILITIES = `
Engine capabilities summary:
- Primitives: box, sphere, cylinder, cone, ring, torus, capsule via deployMesh
- Semantic presets: floor, wall, glass (+ glassKind), cabinet, door, road
- Native Three.js: objType native, geometry.type, parseMode auto|native; domain nativeThree
- JSM geometry/material registry: RoundedBoxGeometry, LineGeometry, LineMaterial, and assetLibrary geometryRef/materialRef expansion
- Groups, lines, info panels, css3d panels, shader surfaces, planes, extrude, buffer/irregular meshes
- Particles (prefer particleEmitter only when requested/implied), weather domains, wind, heat, sprites, tubes, instanced meshes, scene text (objType text)
- particleEmitter: unified objType with simulation cpu|gpuCompute (gpuCompute uses GPUComputationRenderer + ShaderMaterial points); use only for explicit particle/weather/atmospheric effects
- css3dPanel: interactive DOM overlay (distinct from static infoPanel textures)
- sceneConfig.textureQuality optional tier; sceneConfig.extensions container (nativeGeometries, assetLibrary.textureUrlCache)
- Optional customBucket string on descriptors for host batch visibility queries
- ShaderMaterial inline / lib://shaderSource via assetLibrary on native materials
- External GLTF/OBJ, audio, CSG holes/joins/inters
- glTF animationGraph state machine (opt-in): parameters, transitions, crossFade; runtime setAnimationParameter / fireAnimationEvent
- sceneConfig runtime block, declarative rotate animations, PBR metalness/roughness, textures
`;

const THREE_JSON_FEW_SHOT_EXAMPLES = `
Compact reference patterns (adapt sizes/positions to the user prompt; copy only relevant patterns, not every advanced feature):

A) Primitives showcase — sphereModelList + modelList + boxModelList floor (note the point light's intensity is ~50x the ambient/directional lights' — see authoring rule 14):
{"threeJsonId":"demo-primitives","sceneConfig":{"scene":{"background":"#222"},"camera":{"fov":60,"position":{"x":300,"y":200,"z":400}},"controls":{"target":{"x":0,"y":40,"z":0}},"lights":[{"type":"ambient","intensity":0.45},{"type":"directional","intensity":0.9,"position":{"x":200,"y":300,"z":200}},{"type":"point","color":"#ffcc88","intensity":45,"position":{"x":-100,"y":90,"z":120},"decay":2}]},"worldInfo":{"boxModelList":[{"name":"floor","objType":"floor","geometry":{"width":400,"height":8,"depth":300},"position":{"x":0,"y":-4,"z":0},"material":{"type":"standard","color":"#3a4554"}}],"sphereModelList":[{"name":"planet","geometry":{"radius":40,"widthSegments":32,"heightSegments":16},"position":{"x":0,"y":48,"z":80},"material":{"type":"standard","color":"#409eff"}}],"modelList":[{"name":"column","objType":"cylinder","geometry":{"radiusTop":24,"radiusBottom":24,"height":100,"radialSegments":32},"position":{"x":-120,"y":50,"z":0},"material":{"type":"standard","color":"#e6a23c"}}]}}

B) Campus with paths and labels — lineList + infoPanelList + wall/floor:
{"threeJsonId":"demo-campus","sceneConfig":{"scene":{"background":"#20242c"},"camera":{"fov":60,"position":{"x":260,"y":190,"z":320}},"controls":{"target":{"x":0,"y":35,"z":0}},"lights":[{"type":"ambient","intensity":0.5},{"type":"directional","intensity":1.0,"position":{"x":180,"y":260,"z":160}}]},"worldInfo":{"boxModelList":[{"objType":"floor","geometry":{"width":600,"height":8,"depth":500},"position":{"x":0,"y":-4,"z":0},"material":{"color":"#2d3a4a"}},{"objType":"wall","name":"building-a","geometry":{"width":120,"height":80,"depth":90},"position":{"x":-100,"y":40,"z":0},"material":{"color":"#5d7084"}}],"lineList":[{"name":"main-path","objType":"line","points":[{"x":-200,"y":0,"z":200},{"x":0,"y":0,"z":0},{"x":180,"y":0,"z":-120}],"material":{"color":"#ffd04b"}}],"infoPanelList":[{"text":"Building A","type":"text","objType":"infoPanel","panelBoxType":"box","panel":{"position":{"x":-100,"y":90,"z":0},"geometry":{"width":80,"height":24,"depth":4}}}]}}

C) Native torus knot decoration:
{"threeJsonId":"demo-native-knot","worldInfo":{"boxModelList":[],"modelList":[{"name":"knot","objType":"native","geometry":{"type":"TorusKnotGeometry","radius":5,"tube":1.2,"tubularSegments":96,"radialSegments":12,"p":2,"q":3},"material":{"type":"MeshStandardMaterial","color":"#67c23a","metalness":0.2,"roughness":0.45},"position":{"x":0,"y":30,"z":0}}]}}

D) Standard scheme B — sceneConfig + objectList (no worldInfo):
{"threeJsonId":"demo-standard-b","sceneConfig":{"scene":{"background":"#222"},"camera":{"fov":60,"jsonOrigin":"config","position":{"x":120,"y":80,"z":160}},"controls":{"target":{"x":0,"y":20,"z":0},"jsonOrigin":"config"},"lights":[{"type":"ambient","intensity":0.5,"jsonOrigin":"config"},{"type":"directional","intensity":1.0,"position":{"x":80,"y":140,"z":120},"jsonOrigin":"config"}]},"objectList":[{"objType":"box","name":"floor","geometry":{"width":200,"height":6,"depth":140},"position":{"x":0,"y":-3,"z":0},"material":{"color":"#3a4554"}}]}

E) Interactive css3dPanel control surface (no particles unless requested):
{"threeJsonId":"demo-css3d-panel","sceneConfig":{"scene":{"background":"#1a1a2e"},"camera":{"fov":55,"position":{"x":0,"y":80,"z":120}},"controls":{"target":{"x":0,"y":20,"z":0}},"lights":[{"type":"ambient","intensity":0.45},{"type":"directional","intensity":1.0,"position":{"x":50,"y":100,"z":80}}]},"worldInfo":{"boxModelList":[{"objType":"floor","geometry":{"width":300,"height":6,"depth":200},"position":{"x":0,"y":-3,"z":0},"material":{"color":"#2d3a4a"}}],"css3dPanelList":[{"name":"control-panel","objType":"css3dPanel","html":"<button>Start</button>","panel":{"position":{"x":0,"y":40,"z":0},"geometry":{"width":60,"height":40,"depth":2}}}]}}
`;

const THREE_JSON_OUTPUT_REQUIREMENT = `
Output requirement:
- Return ONLY one JSON object string representing the full scene data.
- Do not wrap in Markdown code fences.
- Do not prepend explanations.
- Strict JSON only: every value must be a JSON literal (number, string, boolean, null, object, array).
- Do NOT use JavaScript expressions or identifiers: no Math.PI, no 3.14 / 2, no undefined, no trailing commas, no comments.
- For rotations use decimal radians (e.g. rotationZ: 1.5708 for 90°, 3.14159 for 180°).
`;

const THREE_JSON_IMAGE_REFERENCE_INSTRUCTION = `
You will receive ONE reference image embedded in the user message.
Use it as the primary spatial/visual reference alongside the user's text prompt:
- Infer layout, proportions, and element types; map visible shapes to the appropriate lists and objTypes above.
- Flat ground → floor; vertical planes → wall or glass; curved/ball shapes → sphere or modelList primitives; paths/outlines → lineList; static panel signs → infoPanelList; clickable UI → css3dPanelList; floating titles → objectList objType text.
Keep the same JSON compatibility rules; output only the full scene object.
`;

/** @returns {string} Shared catalog block for scene prompts. */
function buildSceneCapabilityCatalog() {
  return [
    THREE_JSON_AGENT_CAPABILITY_INDEX.trim(),
    THREE_JSON_LIST_PLACEMENT.trim(),
    THREE_JSON_PRIMITIVE_GEOMETRY.trim(),
    THREE_JSON_NATIVE_THREE.trim(),
    THREE_JSON_DOMAIN_USAGE.trim(),
    THREE_JSON_INTENT_GUIDE.trim(),
    THREE_JSON_CORE_CAPABILITIES.trim(),
    THREE_JSON_AGENT_EXAMPLE_INDEX.trim(),
    THREE_JSON_FEW_SHOT_EXAMPLES.trim()
  ].join("\n\n");
}

/** @returns {string} System prompt for scene outline / planning step. */
function buildSceneOutlineSystemPrompt() {
  return [
    "You are a ThreeJSON scene planner. The ThreeJSON engine supports basic primitives plus optional advanced features; plan only the capabilities needed for the requested scene.",
    buildSceneCapabilityCatalog(),
    THREE_JSON_SCENE_AUTHORING_RULES.trim(),
    "",
    "Output a concise bullet outline (English or Chinese) listing:",
    "- Major objects and spatial layout",
    "- Which worldInfo lists and objTypes to use for each element",
    "- Why any non-basic capability is necessary, or omit it",
    "- Materials / colors / optional sceneConfig (camera, lights, background)",
    "Do NOT output JSON."
  ].join("\n\n");
}

/** @returns {string} English system prompt for generating a new scene. */
function buildSceneGenerationSystemPrompt() {
  return [
    "You are an expert ThreeJSON scene JSON generator. ThreeJSON deploys scenes from friendly worldInfo + sceneConfig, or standard JSON (threeJsonId + sceneConfig + objectList), or all-in-objectList standard.",
    buildSceneCapabilityCatalog(),
    THREE_JSON_SCENE_AUTHORING_RULES.trim(),
    THREE_JSON_SCENE_SCHEMA_DESCRIPTION.trim(),
    THREE_JSON_OUTPUT_REQUIREMENT.trim()
  ].join("\n\n");
}

/** @returns {string} English system prompt for generating a new scene from a reference image. */
function buildSceneImageGenerationSystemPrompt() {
  return [
    "You are an expert ThreeJSON scene JSON generator. Combine the user's text prompt with the embedded reference image.",
    buildSceneCapabilityCatalog(),
    THREE_JSON_SCENE_AUTHORING_RULES.trim(),
    THREE_JSON_SCENE_SCHEMA_DESCRIPTION.trim(),
    THREE_JSON_IMAGE_REFERENCE_INSTRUCTION.trim(),
    THREE_JSON_OUTPUT_REQUIREMENT.trim()
  ].join("\n\n");
}

/** @returns {string} English system prompt for editing an existing scene. */
function buildSceneUpdateSystemPrompt() {
  return [
    "You are a ThreeJSON scene JSON editor.",
    "You will receive an existing JSON scene and a user modification request.",
    "Return the FULL updated JSON scene object after applying the requested changes.",
    "When adding objects, use the most appropriate list/objType/geometry fields from the capability catalog.",
    "When editing existing objects, preserve every unrelated property. Size edits should change only the requested dimension(s); for a box height change, keep width/depth and material unchanged unless requested.",
    buildSceneCapabilityCatalog(),
    THREE_JSON_SCENE_AUTHORING_RULES.trim(),
    THREE_JSON_SCENE_SCHEMA_DESCRIPTION.trim(),
    THREE_JSON_OUTPUT_REQUIREMENT.trim()
  ].join("\n\n");
}

/** @returns {string} RFC 6902 patch output for incremental updates (smaller diffs). */
function buildSceneIncrementalUpdateSystemPrompt() {
  return [
    "You are a ThreeJSON scene editor. Apply the user request with minimal changes.",
    "Output ONLY a JSON array of RFC 6902 operations (add | replace | remove) against the scene root.",
    "Patch only the fields needed by the request; preserve unrelated geometry dimensions, materials, object types, lists, and positions.",
    "Allowed path prefixes: /worldInfo, /threeJsonId, /sceneConfig, /controlsConfig, /businessInfo, /objectList, /extensions.",
    "Use slash-separated JSON Pointer paths only (not dots). Example: [{\"op\":\"add\",\"path\":\"/worldInfo/sphereModelList/-\",\"value\":{...}}]",
    "Do NOT return the full scene object. No markdown fences unless wrapping the array.",
    THREE_JSON_AGENT_CAPABILITY_INDEX.trim(),
    THREE_JSON_LIST_PLACEMENT.trim(),
    THREE_JSON_PRIMITIVE_GEOMETRY.trim(),
    THREE_JSON_SCENE_AUTHORING_RULES.trim()
  ].join("\n\n");
}

/** @returns {string} System prompt fragment for capability/layout review passes. */
function buildSceneReviewSystemPrompt() {
  return [
    "You are a ThreeJSON scene reviewer. Improve layout, scale, material consistency, and capability fit.",
    "Use appropriate lists and objTypes when the user intent calls for non-box shapes; keep box-based content when it fits the prompt.",
    "Do not add complexity during review unless it fixes a real user-intent or capability gap.",
    buildSceneCapabilityCatalog(),
    THREE_JSON_SCENE_AUTHORING_RULES.trim(),
    THREE_JSON_OUTPUT_REQUIREMENT.trim()
  ].join("\n\n");
}

export {
  THREE_JSON_LIST_PLACEMENT,
  THREE_JSON_PRIMITIVE_GEOMETRY,
  THREE_JSON_NATIVE_THREE,
  THREE_JSON_DOMAIN_USAGE,
  THREE_JSON_INTENT_GUIDE,
  THREE_JSON_SCENE_AUTHORING_RULES,
  THREE_JSON_SCENE_SCHEMA_DESCRIPTION,
  THREE_JSON_CORE_CAPABILITIES,
  THREE_JSON_FEW_SHOT_EXAMPLES,
  THREE_JSON_OUTPUT_REQUIREMENT,
  THREE_JSON_AGENT_CAPABILITY_INDEX,
  THREE_JSON_AGENT_EXAMPLE_INDEX,
  buildSceneCapabilityCatalog,
  buildSceneOutlineSystemPrompt,
  buildSceneGenerationSystemPrompt,
  buildSceneImageGenerationSystemPrompt,
  buildSceneUpdateSystemPrompt,
  buildSceneIncrementalUpdateSystemPrompt,
  buildSceneReviewSystemPrompt
};

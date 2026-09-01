/**
 * Core command skill for scene AI update — only scene.* / object.* ops (no editor.*).
 */
import {
  createCommandRegistry,
  getCommandHelp,
  looksLikeMicroDslLine,
  splitCommandScript
} from "../command/index.js";
import { getObjectByThreeJsonId } from "../handler/objectRegistry.js";
import { isLoadableScenePayload } from "../handler/sceneFriendlyNormalizer.js";
import { sanitizeAiJsonText, stripMarkdownCodeFence } from "./sceneJsonSanitize.js";
import { buildCompactReferenceDescriptor } from "./sceneSpatialContext.js";

const UPDATE_COMMAND_OPS = new Set([
  "scene.list",
  "scene.validate",
  "scene.applyPatch",
  "scene.export",
  "object.get",
  "object.add",
  "object.remove",
  "object.patch",
  "object.reconcile",
  "material.patch",
  "camera.fit",
  "mesh.inspect",
  "mesh.getTopology",
  "mesh.validate",
  "mesh.edit",
  "mesh.buffer.appendAttribute",
  "mesh.buffer.setAttributeRange",
  "mesh.buffer.appendIndices",
  "mesh.buffer.setIndexRange",
  "mesh.buffer.commit",
  "mesh.buffer.cancel",
  "mesh.bake",
  "mesh.renderViews"
]);

const READ_ONLY_COMMAND_OPS = new Set(["object.get", "scene.list", "scene.validate", "scene.export", "mesh.inspect", "mesh.getTopology", "mesh.validate", "mesh.renderViews"]);

const MUTATING_COMMAND_OPS = new Set([
  "object.add",
  "object.remove",
  "object.patch",
  "material.patch",
  "scene.applyPatch",
  "scene.load"
  ,"mesh.edit"
  ,"mesh.buffer.appendAttribute"
  ,"mesh.buffer.setAttributeRange"
  ,"mesh.buffer.appendIndices"
  ,"mesh.buffer.setIndexRange"
  ,"mesh.buffer.commit"
  ,"mesh.buffer.cancel"
  ,"mesh.bake"
]);

/**
 * @param {string} op
 * @returns {boolean}
 */
export function isSceneMutatingCommandOp(op) {
  const name = String(op || "");
  if (READ_ONLY_COMMAND_OPS.has(name)) {
    return false;
  }
  if (MUTATING_COMMAND_OPS.has(name)) {
    return true;
  }
  if (name.startsWith("material.")) {
    return true;
  }
  if (name.startsWith("object.") && name !== "object.get") {
    return true;
  }
  if (name.startsWith("scene.") && name !== "scene.list" && name !== "scene.validate") {
    return true;
  }
  if (name.startsWith("mesh.") && !READ_ONLY_COMMAND_OPS.has(name)) {
    return true;
  }
  return false;
}

/**
 * @param {Array<{ op?: string }>} commands
 * @returns {boolean}
 */
export function commandListHasMutatingOp(commands) {
  if (!Array.isArray(commands)) {
    return false;
  }
  return commands.some((cmd) => isSceneMutatingCommandOp(cmd?.op));
}

/**
 * @param {Array<{ op?: string, ok?: boolean }>} results
 * @returns {boolean}
 */
export function batchResultsHaveSceneMutation(results) {
  if (!Array.isArray(results)) {
    return false;
  }
  return results.some((item) => item?.ok && isSceneMutatingCommandOp(item?.op));
}

/**
 * Successful AI adjustment including view-only commands (camera.fit).
 * @param {Array<{ op?: string, ok?: boolean }>} results
 * @returns {boolean}
 */
export function batchResultsHaveSuccessfulAdjustment(results) {
  if (!Array.isArray(results)) {
    return false;
  }
  return results.some(
    (item) => item?.ok && (isSceneMutatingCommandOp(item?.op) || item?.op === "camera.fit")
  );
}

/**
 * @param {Array<{ op?: string }>} commands
 * @returns {boolean}
 */
export function commandListIsEmptyOrCommentsOnly(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return true;
  }
  return commands.every((cmd) => {
    const op = String(cmd?.op || "").trim();
    return !op || op === "#" || op.startsWith("#");
  });
}

/**
 * @param {string} script
 * @returns {boolean}
 */
export function commandScriptIndicatesDone(script) {
  const text = String(script || "").trim();
  if (!text) {
    return true;
  }
  return /(?:^|\n)\s*#\s*done\b/i.test(text);
}

/**
 * A successfully applied mutating batch completes an adjustment by default. The model must use
 * this marker only when it genuinely needs a separate inspection or implementation stage.
 * @param {string} script
 * @returns {boolean}
 */
export function commandScriptRequestsContinuation(script) {
  return /(?:^|\n)\s*#\s*continue\b/i.test(String(script || ""));
}

/**
 * @returns {string}
 */
function buildUserIntentPriorityFragment() {
  return [
    "User intent priority:",
    "- The modification request in the user message is the highest priority.",
    "- Scene scale profile, object spatial summary, placement hints, and default scale/group rules are defaults only.",
    "- When the user explicitly specifies size, position, colors, no changes, or view-only adjustments, follow the modification request.",
    "- If the user asks for no scene changes, output an empty script or comment-only script (e.g. # no changes).",
    "- View-only requests (camera aim, fit view, adaptive framing) are valid: use camera.fit and/or scene.applyPatch on sceneConfig.camera/controls without modifying objects."
  ].join("\n");
}

/**
 * @returns {string}
 */
function buildScaleMatchingFragment() {
  return [
    "Scale matching (when the user does NOT specify sizes):",
    "- Read Scene scale profile / Object spatial summary when present.",
    "- Avoid sub-unit human-scale defaults (0.1–2) when typical parts are ≥8.",
    "- New parts should match similar existing objects in the scene (e.g. robot body width ~20–40 when peers are ~30).",
    "- Placement should offset from reference footprints, not default origin (0,0,0) or tiny x offsets.",
    "- When context is insufficient and the user did not specify, auto mode may output full scene JSON."
  ].join("\n");
}

/**
 * @returns {string}
 */
function buildGroupRulesFragment() {
  return [
    "Assembly / multi-part objects (command mode):",
    "- Robot, vehicle, kit, or any multi-part assembly: object.add objType group with explicit threeJsonId FIRST, then object.add parent=<that same threeJsonId> for EVERY part (2+ parts still use a group).",
    "- Mixed objTypes (box + sphere + cylinder + …) under the same parent= are supported.",
    "- Move/rotate the whole assembly: object.patch id=<group threeJsonId> partial={\"rotation\":{\"y\":3.14159}} — parts must already be parented under that group.",
    "- Continuous orbit: create/use a group centered on the orbit center, keep the orbiting child at a non-zero local offset in subScene[], and add animations:[{\"type\":\"rotate\",\"axis\":\"y\",\"speed\":0.2}] to the group; do not fake an orbit by rotating the sphere only.",
    "- Micro DSL (ids must match within the script):",
    "  object.add descriptor={\"objType\":\"group\",\"name\":\"female-robot\",\"threeJsonId\":\"female-robot-grp\"}",
    "  object.add parent=female-robot-grp descriptor={\"objType\":\"box\",\"name\":\"female-robot-body\",...}",
    "  object.add parent=female-robot-grp descriptor={\"objType\":\"sphere\",\"name\":\"female-robot-left-eye\",...}",
    "- JSONL:",
    "  {\"op\":\"object.add\",\"args\":{\"descriptor\":{\"objType\":\"group\",\"name\":\"female-robot\",\"threeJsonId\":\"female-robot-grp\"}}}",
    "  {\"op\":\"object.add\",\"args\":{\"parent\":\"female-robot-grp\",\"descriptor\":{\"objType\":\"box\",\"name\":\"female-robot-body\",...}}}",
    "- parent= must be a threeJsonId from scene context OR set on an earlier object.add in this script. Never use parent=scene or invented ids.",
    "- Omit parent only for standalone scene-root objects. Do NOT add assembly parts at scene root in the same script as their group.",
    "- groupList / subScene / subSceneList in docs apply to full JSON output only, not command scripts (use parent= in commands)."
  ].join("\n");
}

/**
 * Warn when a batch adds an empty group and root-level parts that should use parent=.
 * @param {Array<{ op?: string, args?: object }>} commands
 * @returns {string[]}
 */
export function detectAssemblyParentWarnings(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return [];
  }
  const groupIds = [];
  let rootPartAdds = 0;

  for (let i = 0; i < commands.length; i += 1) {
    const cmd = commands[i];
    if (String(cmd?.op || "") !== "object.add") {
      continue;
    }
    const descriptor = cmd?.args?.descriptor;
    if (!descriptor || typeof descriptor !== "object") {
      continue;
    }
    const parentRaw = cmd?.args?.parent;
    const hasParent = parentRaw != null && String(parentRaw).trim() !== "";
    const objType = String(descriptor.objType || "").trim().toLowerCase();
    if (objType === "group") {
      const id = String(descriptor.threeJsonId || "").trim();
      if (id) {
        groupIds.push(id);
      }
      continue;
    }
    if (!hasParent) {
      rootPartAdds += 1;
    }
  }

  if (groupIds.length === 0 || rootPartAdds === 0) {
    return [];
  }

  const warnings = [];
  for (let i = 0; i < groupIds.length; i += 1) {
    const groupId = groupIds[i];
    const node = getObjectByThreeJsonId(groupId);
    if (!node?.isGroup) {
      continue;
    }
    if (node.children.length === 0) {
      warnings.push(
        `Assembly group "${groupId}" has no children; parts in the same script may need object.add parent=${groupId}.`
      );
    }
  }
  return warnings;
}

/**
 * @param {object} batch
 * @param {Array<{ op?: string, args?: object }>} commands
 * @returns {object}
 */
export function attachAssemblyParentWarnings(batch, commands) {
  const assemblyWarnings = detectAssemblyParentWarnings(commands);
  if (assemblyWarnings.length === 0) {
    return batch;
  }
  return {
    ...batch,
    assemblyWarnings,
    warnings: [...(Array.isArray(batch?.warnings) ? batch.warnings : []), ...assemblyWarnings]
  };
}

/**
 * @returns {string}
 */
function buildCommandUtilityFragment() {
  return [
    "Command utilities (when appropriate):",
    "- object.reconcile id=<threeJsonId> — write live Object3D transform back into userData.objJson (after manual/sceneRuntime moves before export or patch).",
    "- scene.export format=standard — read-only export of current runtime to standard JSON (agent inspection; does not mutate scene).",
    "- scene.applyPatch — document-level RFC6902 on scene JSON when batch path edits are clearer than many object.patch calls."
  ].join("\n");
}

function buildCommandSceneTextFragment(options = {}) {
  const selected = Array.isArray(options.selectedCapabilityIds)
    ? options.selectedCapabilityIds.includes("sceneText")
    : false;
  const rules = [
    "Visible scene text:",
    "- To add visible words/title/caption/label, use object.add descriptor={\"threeJsonId\":\"...\",\"objType\":\"text\",\"content\":\"...\",\"mode\":\"sdf\",\"fontSize\":1.2,\"color\":\"#ffffff\",\"position\":{\"x\":0,\"y\":3,\"z\":0}}. Descriptor name/label fields are metadata and do not display glyphs.",
    "- Prefer mode:sdf for pure text. Use infoPanel only for an explicitly panel-backed board/card/screen; use mode:mesh only for explicitly extruded/beveled/solid letters with mesh.fontJsonUrl."
  ];
  if (selected) {
    rules.push(
      "- sceneText was selected during negotiation: ensure the final applied scene really contains objType:text with the requested content; optional billboard, anchor, align and sdf outline are supported."
    );
  }
  return rules.join("\n");
}

function buildCommandAdvancedCapabilityFragment(options = {}) {
  const selected = new Set(
    Array.isArray(options.selectedCapabilityIds)
      ? options.selectedCapabilityIds.map((id) => String(id || "").trim()).filter(Boolean)
      : []
  );
  const particleSelected = [
    "particles",
    "particleEmitter",
    "particleRaster",
    "webgpuParticles",
    "weather",
    "weatherDomain"
  ].some((id) => selected.has(id));
  const tslSelected = selected.has("webgpuTsl") || String(options.rendererBackend || "").toLowerCase() === "webgpu";
  const tslCodeSelected = selected.has("tslCode");
  const complexMeshSelected = ["complexMesh", "editableMesh", "rawBufferMesh", "subdivisionSurface", "parametricSurface", "implicitSurface", "meshModeling", "meshMorph"].some((id) => selected.has(id));
  const blocks = [];
  if (particleSelected) {
    blocks.push([
      "Negotiated Particle V2 editing capability:",
      "- Add a particle effect with object.add descriptor={\"threeJsonId\":\"...\",\"objType\":\"particleEmitter\",\"source\":{\"type\":\"box|sphere|shell|disc|cone|line|curve|meshSurface|textMask|imageMask\",...},\"emission\":{\"mode\":\"static|continuous|burst\",\"count\":1000,\"seed\":1},\"particle\":{\"lifetime\":{\"min\":2,\"max\":5},...},\"simulation\":{\"backend\":\"cpu|webgl-compute|webgpu-compute\",...},\"render\":{\"type\":\"points|billboard\",...}}.",
      "- Patch only the relevant source/emission/particle/simulation/render block on an existing emitter. Never emit retired top-level count/distribution/motion/material fields, and never replace requested particle text/images with instanced cubes.",
      "- textMask/imageMask are descriptor-activated. webgpu-compute additionally requires a WebGPU scene and the webgpuParticles capability."
    ].join("\n"));
  }
  if (tslSelected) {
    blocks.push([
      "Negotiated WebGPU/TSL editing capability:",
      "- The scene renderer must remain sceneConfig.renderer.backend=webgpu. Use material.patch with a complete TSL material partial, or scene.applyPatch/full JSON when changing the renderer and material atomically.",
      "- TSL material shape: {\"type\":\"tsl\",\"base\":\"standard|physical|basic|lambert|phong|toon|matcap|normal\",\"tsl\":{\"kind\":\"preset|graph\",...}}.",
      "- Graph shape: tsl.source.inline={\"graphVersion\":1,\"nodes\":[{\"id\":\"...\",\"type\":\"...\",...}],\"outputs\":{\"color\":\"nodeId\",\"opacity\":\"nodeId\"}}. Preserve existing graph nodes and unrelated material/model bindings unless the request replaces them."
    ].join("\n"));
  }
  if (tslCodeSelected) {
    blocks.push([
      "Negotiated raw TSL code editing capability:",
      "- tslCode is host-enabled for this turn. A code material uses tsl:{\"kind\":\"code\",\"source\":{\"inline\":\"export default (params, context) => ...\"},\"params\":{...}}; URL source is allowed only when supplied by the user/current scene.",
      "- The inline value is one valid JSON string containing an ESM module whose default factory returns a NodeMaterial, TSL node, output-node map, or mutates context.material. Use context.TSL/context.WEBGPU; do not invent source.sha256.",
      "- Prefer preset/graph when they express the effect cleanly. Preserve existing code byte-for-byte unless the user asks to change that shader/module; the host owns authorization policy."
    ].join("\n"));
  }
  if (complexMeshSelected) {
    const visualReviewRule = options.visualReviewAvailable === true
      ? "- The host supports visual review for this turn. Use mesh.renderViews only after a visible mesh exists and only when another view can answer a concrete shape/proportion question; returned images are attached to the next round."
      : "- Visual review is unavailable for this turn. Do not call mesh.renderViews; use mesh.inspect, mesh.getTopology and mesh.validate instead.";
    blocks.push([
      "Negotiated complex-mesh editing capability:",
      "- Inspect only what is needed: mesh.inspect, then mesh.getTopology id=... part=... page=... pageSize=... and mesh.validate.",
      visualReviewRule,
      "- Change editableMesh with one atomic mesh.edit carrying the current baseRevision. Supported operations include add/set/remove vertex/face, assignPart, setEdgeCrease, extrudeFaces, insetFaces, bevelEdges, bridgeLoops, loopCut, mirror, setModifier, setModifiers and reorderModifier.",
      "- If the control cage already has the correct silhouette and only looks faceted or low resolution, refine locally with deterministic modifiers instead of asking the model to invent more vertices: Catmull-Clark for quad/n-gon cages, Loop for triangle cages, and Smooth only when it improves the intended silhouette. The browser evaluates these modifiers locally while the control topology remains the JSON source.",
      "- Do not use editableMesh/raw bufferMesh for an object that primitives, native parametric geometry, instancing, or CSG can represent faithfully. Complex mesh is for shape/topology that those exact representations cannot express.",
      "- For raw complete coordinates, append/set attribute or index ranges in a mesh.buffer transaction and call mesh.buffer.commit only after the transaction is complete. There is no engine-owned vertex/triangle/segment quota.",
      "- Preserve semantic part names and stable IDs. Do not rewrite or resend an entire dense mesh when a local part query and local operation suffice; do not reduce free-form geometry to primitive blocks merely to save output."
    ].join("\n"));
  }
  return blocks.join("\n\n");
}

function buildCommandTextureAcquisitionFragment() {
  return [
    "Texture-acquisition setting:",
    "- A separate host pipeline chooses trusted texture resources after this edit. Do not invent or guess a texture URL, bundled filename, domain, or asset ID.",
    "- Preserve user-supplied and existing texture fields. For new materials, express the surface with accurate color/metalness/roughness/emissive values and textureRepeat where tiling will be useful.",
    "- Keep flat colors for generic blockouts and plain colored objects."
  ].join("\n");
}

function buildEditScopeEconomyFragment() {
  return [
    "Edit-scope economy:",
    "- When the request changes only position, rotation, scale, parent/layout, visibility, material, animation, camera, or another non-shape property, the compact spatial card and exact transform are sufficient. Use object.patch/material.patch/camera.fit directly.",
    "- Do not request mesh topology or rendered review views for a transform-only or other non-shape edit. Dense vertex coordinates are intentionally omitted from compact context.",
    "- Use mesh.inspect/getTopology/renderViews only when the mesh shape, topology, semantic part, modifier stack, or morph itself must change."
  ].join("\n");
}

/**
 * @returns {string}
 */
function buildCommandPromptRulesFragment(options = {}) {
  return [
    buildUserIntentPriorityFragment(),
    "",
    buildScaleMatchingFragment(),
    "",
    buildEditScopeEconomyFragment(),
    "",
    buildGroupRulesFragment(),
    "",
    buildCommandSceneTextFragment(options),
    "",
    buildCommandAdvancedCapabilityFragment(options),
    "",
    buildCommandUtilityFragment()
  ].join("\n");
}

function buildCommandAnimationFragment(options = {}) {
  if (options.animationCapabilities !== true) return "";
  return [
    "Negotiated animation/event capability:",
    "- Runtime transform fields are position/rotation/scale {x,y,z}; arrays [x,y,z] are accepted. Rotation is radians and formula strings such as PI/2 are valid in full JSON.",
    "- For smooth continuous motion in full JSON use animations type transform/tween or generic expression tracks; do not create endless lifecycle scripts.",
    "- For edits, object.patch may add or replace an object's animations array and sceneConfig.renderLoop should update animations.",
    "- EventScript/lifecycle details are used only when selected during negotiation; preserve existing scripts unless the user asks to change behavior."
  ].join("\n");
}

/**
 * @param {Array<{ op?: string, ok?: boolean, data?: object }>} results
 * @returns {string}
 */
export function formatObjectGetFeedbackFromBatch(results) {
  if (!Array.isArray(results)) {
    return "";
  }
  const blocks = [];
  for (let i = 0; i < results.length; i += 1) {
    const item = results[i];
    if (!item?.ok || !(item.op === "object.get" || item.op === "mesh.inspect" || item.op === "mesh.getTopology" || item.op === "mesh.validate" || item.op === "mesh.renderViews")) {
      continue;
    }
    if (item.op !== "object.get") {
      let result = item.data || null;
      if (item.op === "mesh.renderViews" && result && typeof result === "object") {
        result = {
          ...result,
          views: Array.isArray(result.views)
            ? result.views.map((view) => ({
                name: view?.name || view?.view || "view",
                width: view?.width,
                height: view?.height,
                imageAttached: Boolean(view?.dataUrl || view?.imageUrl || view?.url)
              }))
            : []
        };
      }
      blocks.push(JSON.stringify({ op: item.op, result }, null, 2));
      continue;
    }
    const id = item.data?.threeJsonId || item.data?.id || "";
    const descriptor = item.data?.value ?? item.data?.descriptor ?? null;
    if (!descriptor || typeof descriptor !== "object") {
      continue;
    }
    blocks.push(
      JSON.stringify(
        {
          threeJsonId: id,
          descriptor
        },
        null,
        2
      )
    );
  }
  return blocks.length > 0 ? blocks.join("\n\n") : "";
}

/** Extract image-bearing mesh.renderViews results as OpenAI-compatible image parts. Keeping
 * these separate from the textual command feedback prevents large data URLs from being echoed as
 * plain text while still letting a vision-capable provider inspect the actual rendered views. */
export function extractVisualFeedbackFromBatch(results) {
  if (!Array.isArray(results)) return [];
  const images = [];
  for (const item of results) {
    if (!item?.ok || item.op !== "mesh.renderViews") continue;
    for (const view of Array.isArray(item.data?.views) ? item.data.views : []) {
      const url = String(view?.dataUrl || view?.imageUrl || view?.url || "").trim();
      if (!/^(?:data:image\/|https?:\/\/)/i.test(url)) continue;
      images.push({
        url,
        detail: ["low", "high", "auto"].includes(view?.detail) ? view.detail : "low",
        label: String(view?.name || view?.view || "mesh view")
      });
    }
  }
  return images;
}

/**
 * @param {string} op
 * @returns {boolean}
 */
export function isAiSceneUpdateCommandOp(op) {
  const name = String(op || "");
  return (
    UPDATE_COMMAND_OPS.has(name) ||
    name.startsWith("scene.") ||
    name.startsWith("object.") ||
    name.startsWith("material.") ||
    name.startsWith("camera.") ||
    name.startsWith("mesh.")
  );
}

/**
 * @param {import("../command/registry.js").CommandRegistry} [registry]
 * @returns {string}
 */
export function buildSceneCommandSkillFragment(registry) {
  const resolved = registry || createCommandRegistry();
  const allSpecs = resolved.listSpecs();
  const updateSpecs = allSpecs.filter((spec) => UPDATE_COMMAND_OPS.has(spec.op));
  const tempRegistry = createCommandRegistry(
    Object.fromEntries(
      updateSpecs
        .map((spec) => [spec.op, resolved.getHandler(spec.op)])
        .filter(([, handler]) => typeof handler === "function")
    ),
    updateSpecs
  );
  return getCommandHelp(tempRegistry);
}

/**
 * @returns {string}
 */
/**
 * @returns {string}
 */
/**
 * @param {{ agentRound?: boolean, iterativeApply?: boolean }} [options]
 * @returns {string}
 */
export function buildSceneCommandAutoUpdateSystemPrompt(options = {}) {
  const agentRound = options.agentRound === true;
  const iterativeApply = options.iterativeApply === true;
  const workflow = iterativeApply
    ? [
        "Agent iterative apply workflow:",
        "1. Finish bounded requests in ONE response whenever possible: output the complete minimal mutating command batch. You may append a final `# done` line in the SAME response.",
        "2. A successful mutating batch is treated as complete unless you append `# continue: <concrete remaining goal>`. Use that marker only when the change genuinely needs inspection or a separate independently verifiable stage. Never split work merely because iterative mode is available.",
        options.visualReviewAvailable === true
          ? "3. Intermediate rounds MAY use object.get, mesh.inspect, mesh.getTopology, mesh.validate, or mesh.renderViews to inspect only the data needed for the next local edit; results and requested view images are fed back. Paginate or query a semantic part instead of echoing a dense mesh."
          : "3. Intermediate rounds MAY use object.get, mesh.inspect, mesh.getTopology, or mesh.validate to inspect only the data needed for the next local edit; results are fed back. mesh.renderViews is unavailable for this turn. Paginate or query a semantic part instead of echoing a dense mesh.",
        "4. If the scene already matches the request, output `# done` only. If your current commands finish the request, append `# done` after those commands.",
        "5. Every `# continue` round must name and make progress toward a concrete remaining goal; never repeat an earlier command batch or manufacture cosmetic work to consume rounds."
      ]
    : agentRound
    ? [
        "Agent multi-round command workflow:",
        "1. Intermediate rounds MAY output object.get to inspect descriptors (results are fed back to you).",
        "2. The session MUST end with mutating commands or full scene JSON — never end with only object.get / scene.list.",
        "3. Apply ordinary changes with object.patch/material.patch/object.add/object.remove/scene.applyPatch. For editableMesh topology use mesh.edit with baseRevision; for forced complete coordinates use a mesh.buffer transaction and commit it."
      ]
    : [
        "Single-round workflow:",
        "1. Scene context is in the user message (Scene objects or Object spatial summary / selection / optional full JSON).",
        "2. Do NOT output object.get or scene.list — there is no follow-up round.",
        "3. Output commands, empty/comment-only script when the user requests no changes, camera.fit for view-only requests, OR full valid ThreeJSON scene JSON when restructuring many objects."
      ];
  return [
    "You are a ThreeJSON scene editor.",
    "Apply the user's modification request using ONE of these output forms:",
    "1. (Preferred) Executable command scripts — scene.* / object.* / mesh.* / camera.* (micro DSL or JSONL).",
    "2. (When restructuring many objects) Full valid ThreeJSON scene JSON.",
    "3. RFC 6902 JSON Patch as a JSON array or {\"patch\":[...]} when path-level edits are clearest.",
    "",
    "Prefer commands for small edits (colors, transforms, add/remove objects, stable-ID mesh topology edits, camera framing).",
    "Use full JSON only when commands or JSON Patch would be impractical.",
    "Do NOT output editor.* commands or markdown prose outside the script/JSON.",
    "",
    buildCommandPromptRulesFragment(options),
    buildCommandAnimationFragment(options),
    "",
    buildCommandTextureAcquisitionFragment(options),
    "",
    ...workflow,
    "",
    buildSceneCommandSkillFragment()
  ].join("\n");
}

/**
 * @returns {string}
 */
export function buildSceneCommandUpdateSystemPrompt(options = {}) {
  return [
    "You are a ThreeJSON scene editor that outputs executable command scripts.",
    "Apply the user's modification request using ONLY the core commands below.",
    "This is a SINGLE-ROUND response: there is no follow-up turn to run object.get.",
    "Do NOT output editor.* commands, full scene JSON, or markdown prose outside the script.",
    "",
    "Workflow:",
    "1. Use threeJsonId values from Scene objects or Object spatial summary (and Current selection if present).",
    "2. Do NOT output object.get or scene.list in your script.",
    "3. Apply changes with object.patch (preferred), material.patch, object.add, object.remove, scene.applyPatch, or camera.fit for view-only requests.",
    "4. If the user requests no changes, output empty script or # no changes comments only.",
    "5. Prefer minimal commands — one object.patch per changed object when possible.",
    "",
    "Output format (choose one):",
    "- Micro DSL lines (preferred): object.patch id=abc partial={\"position\":{\"x\":2}}",
    "- JSONL: one {\"op\",\"args\"} object per line",
    "- Optional ```command fence wrapping the script",
    "",
    "Rules:",
    "- Use threeJsonId values from the provided scene context; never invent ids for existing objects.",
    "- object.patch partial must be a partial descriptor (position, rotation, material, geometry, name, etc.).",
    "- object.add descriptor must include objType and required geometry fields.",
    "- Lines starting with # are comments (optional).",
    "",
    buildCommandPromptRulesFragment(options),
    buildCommandAnimationFragment(options),
    "",
    buildCommandTextureAcquisitionFragment(options),
    "",
    buildSceneCommandSkillFragment()
  ].join("\n");
}

/**
 * @param {object} params
 * @param {string} params.modificationRequest
 * @param {Array<{ threeJsonId?: string, name?: string, objType?: string }>} [params.objectList]
 * @param {string|null} [params.selectionId]
 * @param {object|null} [params.selectionDescriptor]
 * @param {string|object} [params.fullSceneJson]
 * @param {Array<object>} [params.objectSpatialCards]
 * @param {object} [params.sceneScaleProfile]
 * @param {Array<object>} [params.referenceObjects]
 * @param {string} [params.placementHints]
 * @returns {string}
 */
export function buildSceneCommandUpdateUserMessage({
  modificationRequest,
  objectList = [],
  selectionId = null,
  selectionDescriptor = null,
  fullSceneJson = "",
  objectGetFeedback = "",
  objectSpatialCards = null,
  sceneScaleProfile = null,
  referenceObjects = null,
  placementHints = "",
  assemblyIntentHints = "",
  singleRound = true,
  agentRound = false
}) {
  const parts = [`Modification request:\n${String(modificationRequest || "").trim()}`];

  const assemblyHints = String(assemblyIntentHints || "").trim();
  if (assemblyHints) {
    parts.push(assemblyHints);
  }

  const spatialCards = Array.isArray(objectSpatialCards) ? objectSpatialCards : [];
  if (spatialCards.length > 0) {
    if (sceneScaleProfile && typeof sceneScaleProfile === "object") {
      parts.push(`Scene scale profile:\n${JSON.stringify(sceneScaleProfile, null, 2)}`);
    }
    parts.push(
      `Object spatial summary (${spatialCards.length}):\n${JSON.stringify(spatialCards, null, 2)}`
    );
    const refs = Array.isArray(referenceObjects) ? referenceObjects : [];
    if (refs.length > 0) {
      parts.push(`Reference objects:\n${JSON.stringify(refs, null, 2)}`);
    }
    const hints = String(placementHints || "").trim();
    if (hints) {
      parts.push(`Placement hints (default suggestions — override when modification request specifies otherwise):\n${hints}`);
    }
  } else if (Array.isArray(objectList) && objectList.length > 0) {
    parts.push(
      `Scene objects (${objectList.length}):\n${JSON.stringify(objectList, null, 2)}`
    );
  } else {
    parts.push("Scene objects: (none listed — use object.add for new objects)");
  }

  if (selectionId) {
    const selectionBlock = {
      threeJsonId: selectionId,
      descriptor: selectionDescriptor && typeof selectionDescriptor === "object"
        ? buildCompactReferenceDescriptor(selectionDescriptor)
        : null
    };
    parts.push(`Current selection:\n${JSON.stringify(selectionBlock, null, 2)}`);
  }

  const fullJson = typeof fullSceneJson === "string"
    ? fullSceneJson.trim()
    : fullSceneJson && typeof fullSceneJson === "object"
      ? JSON.stringify(fullSceneJson, null, 2)
      : "";
  if (fullJson) {
    parts.push(`Full scene JSON (reference only — do not echo back):\n${fullJson}`);
  }

  const getFeedback = String(objectGetFeedback || "").trim();
  if (getFeedback) {
    parts.push(`Object get results (use these descriptors for patches):\n${getFeedback}`);
  }

  if (singleRound && !agentRound) {
    parts.push(
      "Single-round: output mutating commands (object.patch, material.patch, object.add, object.remove, scene.applyPatch), camera.fit for view-only requests, empty/comment-only when user requests no changes. Do not output object.get or scene.list."
    );
  } else if (agentRound) {
    parts.push(
      "Agent round: finish the request now when possible. If the scene already satisfies it, output # done only. A successfully applied mutating batch is final by default; append `# continue: <concrete remaining goal>` only when inspection or a genuinely separate stage is still required. Never repeat work or create changes just to continue."
    );
  } else {
    parts.push("Output ONLY the command script (micro DSL or JSONL).");
  }
  return parts.join("\n\n");
}

/**
 * @param {string} rawText
 * @returns {string}
 */
export function extractCommandScriptText(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) {
    return "";
  }
  const fenced = text.match(/```[ \t]*(?:command|commands|threejson|json)?[ \t]*(?:\r?\n|$)([\s\S]*?)(?:\r?\n)?[ \t]*```/i);
  return (fenced && fenced[1] ? fenced[1] : stripMarkdownCodeFence(text)).trim();
}

/**
 * @param {string} rawText
 * @returns {boolean}
 */
export function isLikelyCommandScriptText(rawText) {
  const body = extractCommandScriptText(rawText);
  if (!body) {
    return false;
  }
  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.op === "string") {
        return (
          UPDATE_COMMAND_OPS.has(parsed.op) ||
          parsed.op.startsWith("scene.") ||
          parsed.op.startsWith("object.") ||
          parsed.op.startsWith("camera.")
        );
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.every(
          (item) =>
            item &&
            typeof item.op === "string" &&
            (UPDATE_COMMAND_OPS.has(item.op) ||
              item.op.startsWith("scene.") ||
              item.op.startsWith("object.") ||
              item.op.startsWith("camera."))
        );
      }
      if (parsed && typeof parsed === "object") {
        return false;
      }
    } catch (_err) {
      /* not single JSON command doc */
    }
  }
  const lines = splitCommandScript(body);
  if (lines.length === 0) {
    return false;
  }
  return lines.every((line) => line.startsWith("{") || looksLikeMicroDslLine(line));
}

/**
 * @param {string} rawText
 * @returns {string}
 */
function extractJsonLikeText(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) {
    return "";
  }
  const fenced = text.match(/```[ \t]*(?:json|threejson)?[ \t]*(?:\r?\n|$)([\s\S]*?)(?:\r?\n)?[ \t]*```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const unfenced = stripMarkdownCodeFence(text);
  if (unfenced !== text) {
    return unfenced;
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return text;
}

/**
 * Detect whether LLM output is commands, scene JSON, or unknown.
 * @param {string} rawText
 * @returns {'commands'|'json'|'unknown'}
 */
export function resolveOutputKind(rawText) {
  if (isLikelyCommandScriptText(rawText)) {
    return "commands";
  }
  try {
    const jsonText = extractJsonLikeText(rawText);
    if (!jsonText) {
      return "unknown";
    }
    const parsed = JSON.parse(sanitizeAiJsonText(jsonText));
    if (isLoadableScenePayload(parsed)) {
      return "json";
    }
  } catch (_err) {
    /* not scene JSON */
  }
  return "unknown";
}

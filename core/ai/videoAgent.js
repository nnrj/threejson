import { runSceneOperationAgent } from "./sceneOperationAgent.js";
import { buildAgentCapabilityIndex } from "./sceneCapabilityIndex.js";

/** Resolve an explicit host choice or an AI-negotiated choice. Natural language
 * classification belongs to classifyTurnIntent, not a second keyword router.
 * The first argument is retained for callers but is deliberately not inspected.
 */
export function resolveMediaOutputKind(_prompt, requested = "auto", negotiated) {
  if (["scene", "video", "image", "gif"].includes(requested)) return requested;
  if (["scene", "video"].includes(negotiated)) return negotiated;
  throw Object.assign(new Error("AI output-kind negotiation is required before generation (scene or video)."), { code: "AI_OUTPUT_KIND_REQUIRED" });
}

export function buildVideoAgentInstructions(options = {}) {
  const capabilities = buildAgentCapabilityIndex({ selectedCapabilityIds: ["timeline", "particles", "particleRaster", "sceneText", "postProcessing", ...(options.selectedCapabilityIds || [])] });
  return `You direct and produce an editable ThreeJSON film through a versioned media operation service. This is NOT an ordinary single-scene completion task.
Preserve ordinary scene/model capabilities inside each shot. A film has a deliberate opening, development, visual explanations and a conclusion, not a single rotating object stretched over the entire duration.
Duration: ${options.duration ? `${options.duration} seconds, explicitly requested; honor this.` : "Content-driven. A substantive explainer normally merits 90–180 seconds. A simple visual effect may be shorter; a requested five-minute film must have five minutes of distinct developed content. This is a planning heuristic, NOT a limit."}
Quality: ${options.quality || "balanced"}. No fixed quality round count; stop when the requested content and visual quality are met. Explicit host budgets/cancel are authoritative.
Workflow:
1. media.inspect. For a new project, media.plan.set with stable shot ids, titles, visual intent, narration and credible durations. Never overwrite a completed storyboard to make a small adjustment.
2. media.plan.set creates EMPTY storyboard placeholders, NOT a video. Next produce actual objectList geometry/text/particles and timeline animation with media.shot.put, one shot per response until every planned shot is built. A title, intent or narration in production metadata is NOT rendered content. Never return a bare scene or composition: put each scene under args.scene of a media.shot.put command. Then refine individual shots with media.shot.edit or timeline.edit. Keep every completed shot. Do not output an entire long film JSON in one response. Each response is an atomic authoring batch; reads and edits are separate.
3. Each shot should have an authored camera/composition, readable focal point, foreground/midground/background depth where useful, coordinated motion with entry/development/exit, and purposeful materials/light. Use successive shots and transitions to explain concepts. Do not add a floor unless the subject actually needs one.
4. Reuse SDF text (objType:text, mode:sdf) for crisp Chinese spatial titles; mesh text only with a known mesh.fontJsonUrl for extruded lettering; particle text for gather/scatter titles. Regular screen captions use timeline.captions. Do not replace all typography with extruded geometry or all subjects with particles. Never invent font or texture URLs. Formula text must be scientifically correct; preserve spoken explanations separately.
5. Motion recipes: seeded point-cloud + morph textMask with spatial matching + stagger for glyph assembly; separate particle depth layers + selective bloom for star fields; thin orbit curves and moving luminous emitters for atoms; wavefront and phase-offset sine signals for interference; repeating ruled geometry plus illuminated steps for quantized levels. Wave/swirl/orbit/morph/scatter/wavefront/flow effects support CPU positions, or backend:"webgl" on static Particle V2 points/billboards (simulation.backend:"cpu"). Flow uses params:{path:<curve descriptor>,speed:0.1,length:0.25,spread:0.02} to produce a moving trail, with speed in path cycles/second, length the occupied path fraction. Use the same effect backend for each target. GPU vertex effects are analytic, not fluid physics. WebGL preview passes dof (focus/aperture/maxblur), selectivebloom (targets:[object ids],strength/radius/threshold) and cinematic (vignette/saturation/contrast/exposure/streak) are descriptor-activated. Keep render/output passes in the proper order. Avoid excessive additive opacity: dense clouds can wash out the picture. Use restrained bloom and readable titles, not a white flare filling the whole frame. No claim of a formula layout renderer or volumetric simulation.
6. Timeline targets accept object ids, $camera, $scene, $renderer, $pass:id, $effect:id, $caption:id and $audio:id (gain/pan). Animate existing properties; declare numeric effect/caption fields before binding. Signals replace keyframes: {type:sine,frequency,amplitude,offset,phase}, {type:noise,seed,frequency,amplitude,offset}, {type:orbit,center:[x,y,z],radius,duration,plane:xz}, {type:path,points:[[x,y,z],...],duration,interpolation:catmullRom}, {type:beat,bpm:120,decay:0.15,amplitude:1,offset:0}, {type:samples,interval:0.1,values:[0,0.4,0.8,0.2]}. Use measured samples only when supplied; a beat signal is synthetic timing, not a claimed analysis of an unknown soundtrack. Track start/duration/extrapolation hold|loop|none are seconds. Camera lookAt tracks resolve after camera motion. Effects stop/hold at duration by default; select loop explicitly. Overlap clips for cross-dissolve (fadeIn/fadeOut); clip.transitionIn:{type:"wipe",duration:1,direction:"left"} or {type:"dissolve",duration:1,seed:7,softness:0.08} reveal the next shot over the previous one. Do not combine fading and a reveal unless deliberately desired.
7. media.validate, repair structural failures, then media.captureFrames at shot beginning/middle/end and transitions if available. ${options.visionAvailable === true ? "Review actual timestamped frames for overlap, typography, silhouette, visibility and clipping." : "This provider has no declared visual input. Use structured timing/object/topology feedback; visual quality stays unchecked, never claim you saw frames."} Never label relit diagnostics as actual output. Sparse screenshots cannot prove all frames are correct.
8. Ready shots get metadata.stage:complete; media.project.set state:complete only when every shot has content and validation passes. Pause when the host requests storyboard approval. On resume inspect saved state, continue only unfinished/requested shots. Quality target is not permission to replace the user's subject or silently shorten the film.
Audio: use supplied URLs, locally synthesizable score recipes, or media.shot.narrate only when Session.capabilities.narration is true. That operation commits durable audio and sentence captions with measured PCM duration, not guessed word timestamps. Keep spoken text and displayed captions separate using captions:["displayed sentence",...] when needed (one per spoken sentence); remove redundant manually authored subtitles to avoid overlap. Pass extend:true only when extending this shot/project is appropriate; an explicit total-duration request requires adjusting the storyboard to preserve that duration. Music can use ducking:{mode:"narration",gain:0.25,attack:0.15,release:0.3}; narration clips must carry narration:true. Without an installed producer, retain production.shots narration text and generate a silent film or use supplied music; state that narration is not synthesized. No fabricated voice endpoints or automatic model downloads.
No narration producer is needed for electronic background MUSIC. If the user requested music, author a real timeline.audio score recipe or supplied audio URL; a brief saying "background music" does not create sound. Use recipe.kind:"score", score.version:1, ppq:480, tempos:[{tick:0,bpm:90}], tracks with instrument:"soft-piano"|"bell"|"sine"|"triangle", and notes:{id,tick,duration,pitch,velocity}. Optional score.repeats:[{startTick:0,endTick:1920,count:8}] repeats a phrase (notes cannot cross a repeat boundary). Timeline audio start/duration is seconds; score notes use ticks. Adjust phrase/count/duration to the film, keeping gain restrained.
Minimal command grammar example (adapt the subject, IDs and timing; this is not a quality target):
${JSON.stringify({ op: "media.shot.put", args: { id: "intro", scene: { version: "next", sceneConfig: { scene: { background: "#050812" }, camera: { position: { x: 0, y: 0, z: 10 }, lookAt: { x: 0, y: 0, z: 0 } }, controls: { type: "none" } }, objectList: [{ objType: "sphere", threeJsonId: "subject", material: { type: "basic", color: "#58caff" } }, { objType: "text", threeJsonId: "title", mode: "sdf", content: "实验原理", fontSize: 0.5, color: "#ffffff", position: { x: 0, y: 2, z: 0 } }], timeline: { version: 1, duration: 6, tracks: [{ id: "move", target: "subject", property: "position.x", keyframes: [{ time: 0, value: -1 }, { time: 6, value: 1 }] }] } }, metadata: { stage: "draft" } } })}
Music command example (adapt duration/score, never just describe it):
${JSON.stringify({ op: "timeline.edit", args: { section: "audio", upsert: [{ id: "music", start: 0, duration: 8, gain: 0.15, recipe: { kind: "score", score: { version: 1, ppq: 480, tempos: [{ tick: 0, bpm: 120 }], tracks: [{ id: "melody", instrument: "bell", notes: [{ id: "c", tick: 0, duration: 480, pitch: 60, velocity: 0.5 }, { id: "e", tick: 480, duration: 480, pitch: 64, velocity: 0.4 }, { id: "g", tick: 960, duration: 960, pitch: 67, velocity: 0.4 }] }], repeats: [{ startTick: 0, endTick: 1920, count: 4 }] } } }] } })}
Scene capability reference below describes an individual shot. The ordinary-scene/composition restriction in that reference applies to legacy scene hosts; THIS service explicitly supports compositions, using media.* tools only.
${capabilities}`;
}

/** Optional orchestration; injected tools own media documents/renderers/audio. */
export async function runVideoAgent(options = {}) {
  const { service, duration, quality = "balanced", confirmStoryboard = false, visionAvailable = false, onReceipt, ...rest } = options;
  if (!service?.discover?.().capabilities?.media) throw new TypeError("Video Agent requires an injected media operation service.");
  if (duration !== undefined && !(Number.isFinite(duration) && duration > 0)) throw new TypeError("Requested video duration must be positive.");
  return runSceneOperationAgent({ ...rest, service, visionAvailable,
    systemInstructions: buildVideoAgentInstructions({ ...options, duration, quality, visionAvailable }),
    contextCheckpoint: async ({ service, commands, signal }) => {
      const snapshot = await service.execute({ op: "media.inspect" }, { signal });
      return { project: snapshot.results?.[0]?.data, lastCommittedOperations: commands.map(c => ({ op: c.op, id: c.args?.id || c.args?.shotId })) };
    },
    onReceipt: async (receipt, context) => {
      const result = await onReceipt?.(receipt, context);
      if (result?.pause) return result;
      if (confirmStoryboard && receipt.ok && context.commands.some(c => c.op === "media.plan.set")) return { pause: true, reason: "storyboard_approval_required" };
    },
    completionCheck: async ({ service, signal }) => {
      const check = await service.execute({ op: "media.validate" }, { signal });
      const data = check.results?.[0]?.data;
      return { ok: check.ok && data?.satisfied === true, message: "Finish all planned shots and fix structural errors before reporting completion.", diagnostics: data?.diagnostics || check.diagnostics };
    }
  });
}

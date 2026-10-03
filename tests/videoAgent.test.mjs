import test from "node:test";
import assert from "node:assert/strict";
import { runVideoAgent, resolveMediaOutputKind, buildVideoAgentInstructions } from "../core/ai/videoAgent.js";
import { createMediaProjectSession, createMediaOperationService } from "../packages/media-kit/js/index.js";
import { readFile } from "node:fs/promises";
import { parseCommandScript } from "../core/command/parser.js";
import { compileScore } from "../packages/audio-kit/js/score.js";
import { runAiVideoTurn } from "../packages/host-kit/js/videoTurn.js";
import { getMediaProductionSummary, formatMediaProductionSummary, getMediaContinuation } from "../packages/host-kit/js/mediaProductionFeedback.js";
import { buildResultDigest, runAiTurnSummary } from "../packages/host-kit/js/aiTurnOrchestrator.js";

const scene = id => ({ objectList: [{ objType: "sphere", threeJsonId: id }], timeline: { duration: 2, tracks: [{ id: "spin", target: id, property: "rotation.y", keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }] }] } });
const message = command => ({ message: { role: "assistant", content: typeof command === "string" ? command : JSON.stringify(command) } });
test("video routing keeps ordinary scenes and explicit host choices intact", () => {
  assert.equal(resolveMediaOutputKind("生成一段介绍双缝干涉的视频"), "video");
  assert.equal(resolveMediaOutputKind("生成一个播放视频的电视"), "scene");
  assert.equal(resolveMediaOutputKind("create a room with video texture"), "scene");
  assert.equal(resolveMediaOutputKind("生成汽车，不要视频"), "scene");
  assert.equal(resolveMediaOutputKind("生成汽车", "video"), "video");
  const prompt = buildVideoAgentInstructions({ duration: 300 });
  assert.match(prompt, /300 seconds/); assert.match(prompt, /mode:sdf/); assert.match(prompt, /selectivebloom/); assert.match(prompt, /No fixed quality round count/);
});
test("storyboard confirmation pauses after a durable plan; resuming uses existing shots", async () => {
  const session = createMediaProjectSession(), service = createMediaOperationService({ session });
  const result = await runVideoAgent({ service, prompt: "Make a film", confirmStoryboard: true, request: async () => message({ op: "media.plan.set", args: { shots: [{ id: "a", title: "A", duration: 2 }] } }) });
  assert.equal(result.stopReason, "storyboard_approval_required"); assert.equal(session.inspect().duration, 2);
  let calls = 0;
  const resumed = await runVideoAgent({ service, prompt: "Approved, continue", request: async () => ++calls === 1 ? message({ op: "media.shot.put", args: { id: "a", scene: scene("actor"), metadata: { stage: "complete" } } }) : message("# done") });
  assert.equal(resumed.completed, true); assert.equal(session.document.scenes.a.objectList[0].threeJsonId, "actor"); session.dispose();
});
test("long films use incremental shots beyond 64 responses with compact committed checkpoints", async () => {
  const session = createMediaProjectSession(), service = createMediaOperationService({ session });
  let round = 0; const lengths = [];
  const result = await runVideoAgent({ service, prompt: "Make 66 two-second shots", request: async ({ messages }) => {
    lengths.push(JSON.stringify(messages).length);
    if (round === 0) { round++; return message({ op: "media.plan.set", args: { shots: Array.from({ length: 66 }, (_, i) => ({ id: `s${i}`, title: `Shot ${i}`, duration: 2 })) } }); }
    if (round <= 66) { const id = `s${round++ - 1}`; return message({ op: "media.shot.put", args: { id, scene: scene(`actor-${id}`), metadata: { stage: "complete" } } }); }
    return message("# done");
  } });
  assert.equal(result.completed, true); assert.equal(result.requests, 68); assert.equal(session.inspect().duration, 132);
  assert.ok(lengths.at(-1) < lengths[0] + 25000, "Committed geometry and tool exchanges must not accumulate every round.");
  assert.equal(session.document.timeline.clips.length, 66); session.dispose();
});
test("premature done is repaired, and provider failures preserve finished shots", async () => {
  const session = createMediaProjectSession(), service = createMediaOperationService({ session }); let round = 0;
  const result = await runVideoAgent({ service, prompt: "Make a film", request: async () => {
    round++;
    if (round === 1) return message("# done");
    if (round === 2) return message({ op: "media.plan.set", args: { shots: [{ id: "a", title: "A", duration: 2 }, { id: "b", title: "B", duration: 2 }] } });
    if (round === 3) return message({ op: "media.shot.put", args: { id: "a", scene: scene("actor") } });
    throw new Error("Provider unavailable");
  } });
  assert.equal(result.completed, false); assert.equal(result.stopReason, "provider_or_execution_failed");
  assert.equal(session.document.scenes.a.objectList[0].threeJsonId, "actor"); assert.equal(session.inspect().shots[1].stage, "planned"); session.dispose();
});

test("fenced multi-line JSONL shot commands are accepted without altering authored strings", async () => {
  const session = createMediaProjectSession(), service = createMediaOperationService({ session }); let round = 0;
  const plan = { op: "media.plan.set", args: { shots: [{ id: "intro", title: "Intro", duration: 2 }] } };
  const put = { op: "media.shot.put", args: { id: "intro", scene: scene("actor"), metadata: { stage: "complete", narration: "# done\n```json\nnot a command" } } };
  const result = await runVideoAgent({ service, prompt: "Make a video", request: async () => message(++round === 1
    ? "```jsonl\n" + JSON.stringify(plan, null, 2) + "\n" + JSON.stringify(put, null, 2) + "\n```" : "```\n# done\n```") });
  assert.equal(result.completed, true, result.message); assert.equal(result.requests, 2);
  assert.equal(session.document.production.shots.intro.narration, put.args.metadata.narration); session.dispose();
});

test("invalid operation output exposes diagnostics and never turns an empty storyboard into a successful video", async () => {
  let requestCount = 0, previews = 0; const events = [];
  const result = await runAiVideoTurn({ userPrompt: "生成双缝干涉视频，要有背景音乐", onSceneDraft: () => previews++, onAgentProgress: event => events.push(event), request: async () => {
    if (++requestCount === 1) return message({ op: "media.plan.set", args: { shots: [{ id: "a", title: "实验装置", duration: 22 }] } });
    return message("I will build the shots next.");
  } });
  assert.equal(result.agentResult.completed, false); assert.equal(result.agentResult.stopReason, "repeated_invalid_output");
  assert.equal(result.agentResult.agentUsed, true); assert.ok(result.agentResult.steps.some(step => step.kind === "invalid_command_output" && !step.ok));
  assert.equal(result.sceneJson.production.state, "paused"); assert.ok(result.sceneJson.production.lastError);
  assert.equal(previews, 0); assert.ok(!events.some(event => event.kind === "stage_preview"));
  assert.ok(events.some(event => event.stage === "storyboard"));
});

test("the reported 90-second empty film gets factual feedback and can resume without replanning", async () => {
  const project = JSON.parse(await readFile(new URL("./fixtures/video-storyboard-paused.json", import.meta.url), "utf8"));
  const summary = getMediaProductionSummary(project);
  assert.equal(summary.duration, 90); assert.equal(summary.totalShots, 4); assert.equal(summary.producedShots, 0); assert.equal(summary.audio, 0);
  const recap = await runAiTurnSummary({ userPrompt: "生成双缝干涉视频，要有音乐", resultDigest: buildResultDigest(project), responseLanguage: "Simplified Chinese", providerOptions: { request: () => { throw new Error("No AI summary needed"); } } });
  assert.match(recap, /尚未生成可播放画面/); assert.match(recap, /尚未生成音轨/); assert.match(recap, /repeated_invalid_output/);
  assert.equal(getMediaContinuation(project).label, "继续制作视频"); assert.doesNotMatch(getMediaContinuation(project).prompt, /复杂模型/);
  let round = 0;
  const result = await runAiVideoTurn({ userPrompt: getMediaContinuation(project).prompt, project, request: async () => {
    if (++round <= 4) return message({ op: "media.shot.put", args: { id: `shot${round}`, scene: scene(`actor${round}`), metadata: { stage: "complete" } } });
    return message("# done");
  } });
  assert.equal(result.agentResult.completed, true); assert.equal(result.sceneJson.timeline.clips.length, 4); assert.equal(result.mediaProject.duration, 90);
  assert.equal(result.sceneJson.production.lastError, ""); assert.equal(getMediaProductionSummary(result.sceneJson).producedShots, 4);
  assert.deepEqual(result.sceneJson.timeline.clips, project.timeline.clips);
});

test("video command examples execute and local background score has actual musical events", async () => {
  const commands = buildVideoAgentInstructions().split("\n").filter(line => line.startsWith('{"op":')).flatMap(parseCommandScript);
  const session = createMediaProjectSession(), service = createMediaOperationService({ session });
  await service.execute({ op: "media.plan.set", args: { shots: [{ id: "intro", title: "Intro", duration: 8 }] } });
  for (const command of commands) { const receipt = await service.execute(command); assert.equal(receipt.ok, true, receipt.error); }
  const score = compileScore(session.document.timeline.audio[0].recipe.score);
  assert.ok(score.events.length > 0); assert.equal(score.duration, 8); session.dispose();
});

test("audio and caption-only films have factual summaries, storyboard approval is not an error", () => {
  const film = { documentType: "composition", scenes: { a: { objectList: [], timeline: { captions: [{ id: "title", text: "Hello", duration: 3 }] } } }, timeline: { clips: [{ id: "a", source: "a", duration: 3 }], audio: [{ id: "music" }] }, production: { state: "complete", shots: { a: { stage: "complete" } } } };
  const summary = getMediaProductionSummary(film); assert.equal(summary.producedShots, 1); assert.equal(summary.audio, 1);
  assert.match(formatMediaProductionSummary(summary, "English"), /Video content generated/);
  film.production.stopReason = "storyboard_approval_required"; film.production.state = "storyboard";
  assert.match(formatMediaProductionSummary(getMediaProductionSummary(film)), /等待确认分镜/);
});

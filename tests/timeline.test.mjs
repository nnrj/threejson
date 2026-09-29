import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createSceneClock, createSceneTimelineController, validateTimeline, getActiveClips, sampleTimelineTrack, prepareTimelineResources } from "../core/timeline.js";
import { createRuntimeContext, attachRuntimeContext } from "../core/runtime/runtimeContext.js";
import { deployParticleCpuEmitter } from "../core/builder/particle/particleCpuSimulation.js";
import { createRenderLoop } from "../core/handler/frameLoopHandler.js";
import { createSceneRuntime } from "../core/handler/sceneRuntimeHandler.js";
import { prepareParticleEffects } from "../core/timeline/particleEffects.js";
import { normalizeScenePayload } from "../core/handler/sceneFriendlyNormalizer.js";
import { convertStandardJsonToFriendlyJson, convertFriendlyJsonToStandardJson } from "../core/util/util.js";
import { extractRootMetadataFromBase } from "../core/util/scenePayloadMerge.js";

test("timeline clock pause, seek, end and looping are explicit", () => {
  const clock = createSceneClock({ duration: 3 });
  clock.advance(1); assert.equal(clock.time, 0); clock.play(); clock.advance(5);
  assert.equal(clock.time, 3); assert.equal(clock.playing, false);
  clock.seek(1); clock.play(); clock.setRate(2); clock.advance(.5); assert.equal(clock.time, 2);
  clock.pause(); clock.advance(8); assert.equal(clock.time, 2);
  const loop = createSceneClock({ duration: 3, loop: true }); loop.play(); loop.advance(7); assert.equal(loop.time, 1);
  assert.throws(() => clock.seek(-1));
});
test("timeline validates schema and clip source time independent of start", () => {
  assert.throws(() => validateTimeline({ tracks: [{ id: "x", target: "a", property: "x", keyframes: [{ time: 1, value: 2 }, { time: 1, value: 3 }] }] }));
  const timeline = validateTimeline({ clips: [{ id: "c", start: 5, duration: 4, source: "a.json", sourceStart: 10, rate: 2, fadeIn: 2 }] });
  assert.equal(getActiveClips(timeline, 6)[0].sourceTime, 12);
  assert.equal(getActiveClips(timeline, 6)[0].opacity, .5);
  assert.equal(getActiveClips(timeline, 9).length, 0);
});
test("absolute keyframes, legacy rotation, colors and source JSON survive random seeking", () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ color: "red" }));
  const record = { threeJsonId: "box", animations: [{ type: "rotate", axis: "y", speed: 1 }] };
  mesh.userData.objJson = record; scene.add(mesh);
  const timeline = { duration: 4, tracks: [
    { id: "move", target: "box", property: "position", keyframes: [{ time: 0, value: [0, 0, 0] }, { time: 4, value: [8, 4, 0] }] },
    { id: "color", target: "box", property: "material.color", keyframes: [{ time: 0, value: "red" }, { time: 4, value: "blue" }] }
  ] };
  const original = JSON.stringify({ record, timeline });
  const controller = createSceneTimelineController({ scene, camera }, timeline);
  for (const t of [2, 3, 1, 2, 2]) { controller.evaluateAt(t); assert.equal(mesh.position.x, t * 2); assert.equal(mesh.rotation.y, t); }
  assert.equal(mesh.material.color.r, .5); assert.equal(mesh.material.color.b, .5);
  assert.equal(JSON.stringify({ record, timeline }), original); controller.dispose();
});
test("CPU particles use reproducible fixed ticks across output fps and backward seeks", () => {
  const scene = new THREE.Scene(), ctx = createRuntimeContext(); attachRuntimeContext(scene, ctx);
  const points = deployParticleCpuEmitter({ objType: "particleEmitter", threeJsonId: "particles", source: { type: "box", width: 4, height: 4, depth: 4 }, emission: { count: 12, seed: 42, mode: "continuous", rate: 6, loop: true }, particle: { lifetime: 1, velocity: { x: 1, y: 2, z: 3 } }, simulation: { backend: "cpu", gravity: { x: 0, y: -1, z: 0 } } }, scene);
  const player = createSceneTimelineController({ scene, runtimeContext: ctx }, { duration: 4 });
  player.evaluateAt(2); const snapshot = Array.from(points.geometry.attributes.position.array);
  player.evaluateAt(0); for (let frame = 1; frame <= 60; frame++) player.evaluateAt(frame / 30);
  assert.deepEqual(Array.from(points.geometry.attributes.position.array), snapshot);
  player.evaluateAt(.4); player.evaluateAt(2); assert.deepEqual(Array.from(points.geometry.attributes.position.array), snapshot);
  player.dispose(); ctx.dispose();
});
test("manual render works while stopped without advancing controls or animation", () => {
  let renders = 0, controls = 0;
  const loop = createRenderLoop({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer: { render() { renders++; } }, controls: { update() { controls++; } } });
  assert.equal(loop.renderOnce(), false); assert.equal(loop.renderCurrentFrame(), true);
  assert.equal(renders, 1); assert.equal(controls, 0);
});

test("object-only timelines preserve interactive cameras; camera tracks own camera motion", () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  let updates = 0;
  const loop = createRenderLoop({ scene, camera, renderer: { render() {} }, controls: { update() { updates++; } }, config: { autoResize: false, firstAutoResize: false }, requestFrame() { return 1; }, cancelFrame() {} });
  const runtime = { scene, camera, renderLoop: loop };
  const player = createSceneTimelineController(runtime, { duration: 2 });
  player.play(); camera.position.set(4, 5, 6); player.evaluateAt(1); loop.renderOnce(100);
  assert.deepEqual(camera.position.toArray(), [4, 5, 6]); assert.equal(updates, 1);
  player.dispose();
  const cameraPlayer = createSceneTimelineController(runtime, { duration: 2, tracks: [{ id: "aim", target: "$camera", property: "lookAt", keyframes: [{ time: 0, value: [0, 0, 0] }] }] });
  loop.renderOnce(200); assert.equal(updates, 1); cameraPlayer.dispose(); loop.stop();
});

test("resource readiness can be cancelled while a font is still pending", async () => {
  const scene = new THREE.Scene(), text = new THREE.Object3D(), controller = new AbortController();
  text.isTroikaText = true; text.sync = () => {}; scene.add(text);
  const pending = prepareTimelineResources({ scene }, { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { name: "AbortError" });
});

test("renderer ownership transfers only after a runtime is successfully prepared", () => {
  let disposals = 0;
  const renderer = { dispose() { disposals++; } }, config = { controls: { type: "none", enabled: false }, renderLoop: { autoStart: false } };
  const failed = createSceneRuntime({ renderer, config }); failed.dispose(); assert.equal(disposals, 1);
  const transferred = createSceneRuntime({ renderer, config }); transferred.setRendererOwnership(false); transferred.dispose(); assert.equal(disposals, 1);
  renderer.dispose(); assert.equal(disposals, 2);
});
test("timeline color and quaternion sampling do not mutate keyframes", () => {
  const track = { keyframes: [{ time: 0, value: [0, 0, 0, 1] }, { time: 2, value: [0, 1, 0, 0] }] };
  const q = sampleTimelineTrack(track, 1, "quaternion"); assert.ok(Math.abs(q.y - Math.SQRT1_2) < 1e-8);
  assert.deepEqual(track.keyframes[0].value, [0, 0, 0, 1]);
});

test("lookAt tracks resolve after transforms, independent of descriptor ordering", () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const player = createSceneTimelineController({ scene, camera }, { duration: 2, tracks: [
    { id: "aim", target: "$camera", property: "lookAt", keyframes: [{ time: 0, value: [0, 0, 0] }] },
    { id: "move", target: "$camera", property: "position", keyframes: [{ time: 0, value: [0, 0, 5] }, { time: 2, value: [5, 2, 5] }] }
  ] });
  for (const time of [2, 1, 0, 2]) {
    player.evaluateAt(time);
    const direction = camera.getWorldDirection(new THREE.Vector3());
    assert.ok(direction.distanceTo(camera.position.clone().negate().normalize()) < 1e-7);
  }
  player.dispose();
});
test("timeline metadata survives standard/friendly conversion and export metadata selection", async () => {
  const source={version:"next",sceneConfig:{},objectList:[],timeline:{version:1,duration:8,tracks:[]},output:{width:320,height:180}};
  const friendly=await convertStandardJsonToFriendlyJson(source),standard=await convertFriendlyJsonToStandardJson(friendly);
  assert.deepEqual(standard.timeline,source.timeline);assert.deepEqual(extractRootMetadataFromBase(source).timeline,source.timeline);
  assert.deepEqual(normalizeScenePayload(source).compatPayload.timeline,source.timeline);
});
test("particle effects compose without feeding output-frame state back into simulation", async () => {
  const scene=new THREE.Scene(),ctx=createRuntimeContext();attachRuntimeContext(scene,ctx);
  const points=deployParticleCpuEmitter({objType:"particleEmitter",threeJsonId:"p",source:{type:"box",width:2,height:2,depth:2},emission:{mode:"static",count:8,seed:6},particle:{lifetime:0,velocity:{x:.2,y:.1,z:0}},simulation:{backend:"cpu"}},scene);
  const effects=await prepareParticleEffects({scene},[{id:"wave",target:"p",operator:"wave",params:{amplitude:.4}},{id:"orbit",target:"p",operator:"orbit",params:{radius:.5}}]);
  const player=createSceneTimelineController({scene,runtimeContext:ctx},{duration:4},{effects});
  player.evaluateAt(2);const result=Array.from(points.geometry.attributes.position.array);
  player.reset();for(let i=1;i<=120;i++)player.evaluateAt(i/60);
  assert.deepEqual(Array.from(points.geometry.attributes.position.array),result);
  player.evaluateAt(.2);player.evaluateAt(2);assert.deepEqual(Array.from(points.geometry.attributes.position.array),result);player.dispose();ctx.dispose();
});

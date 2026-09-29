import test from "node:test";
import assert from "node:assert/strict";
import { compileScore, createScoreRenderer, encodeWav, createPcmMixer, produceAudio } from "../packages/audio-kit/js/index.js";
import { validateMediaDocument, openMediaDocument, packMediaDocument } from "../packages/media-kit/js/documents.js";
import { resolveFrameRange, renderImage, renderVideo } from "../packages/media-kit/js/export.js";
import { createMediaProject } from "../packages/media-kit/js/project.js";
import * as THREE from "three";

const score = { version: 1, ppq: 480, tempos: [{ tick: 0, bpm: 120 }, { tick: 480, bpm: 60 }], tracks: [{ id: "piano", instrument: "soft-piano", notes: [{ id: "a", tick: 0, duration: 480, pitch: 60, tie: "held" }, { id: "b", tick: 480, duration: 480, pitch: 60, tie: "held" }] }] };
test("score compiles tempo changes and ties without modifying notation", () => {
  const source = JSON.stringify(score), plan = compileScore(score);
  assert.equal(plan.events.length, 1); assert.equal(plan.duration, 1.5); assert.equal(JSON.stringify(score), source);
  const repeated = compileScore({ ...score, repeats: [{ startTick: 0, endTick: 960, count: 4 }] });
  assert.equal(repeated.duration, 6); assert.equal(repeated.events.length, 4);
});
test("score and audio mix yield sample-identical arbitrary blocks", () => {
  const synth = createScoreRenderer(score, { sampleRate: 8000 });
  const whole = synth.render(0, 12000), first = synth.render(0, 7000), last = synth.render(7000, 5000);
  assert.deepEqual(whole.channels[0], Float32Array.from([...first.channels[0], ...last.channels[0]]));
  assert.ok(whole.channels[0].some((value) => Math.abs(value) > .01));
  const mixer = createPcmMixer([{ pcm: whole, start: .5, sourceStart: .2, rate: 2, duration: .5, fadeIn: .1 }], { sampleRate: 8000 });
  const pcm = mixer.render(0, 8000); assert.ok(pcm.channels[0].slice(0, 4000).every((value) => value === 0));
  assert.deepEqual(mixer.render(6000, 2000).channels[0], pcm.channels[0].slice(6000));
  const wav = encodeWav(pcm); assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF"); assert.equal(wav.length, 44 + 8000 * 4);
});
test("audio and model omissions are explicit, not fake generated speech", async () => {
  await assert.rejects(produceAudio({ kind: "tts", producer: "missing" }), { code: "AUDIO_PRODUCER_UNAVAILABLE" });
  assert.throws(() => createPcmMixer([{ pcm: { sampleRate: 100, channels: [new Float32Array(100)] }, duration: 10 }]));
});
test("lazy score mixing is sample-identical without allocating the whole soundtrack", () => {
  const renderer=createScoreRenderer(score,{sampleRate:8000}),pcm=renderer.render(0,Math.ceil(renderer.duration*8000));
  const settings={start:.2,sourceStart:.1,rate:1.2,duration:.8,loop:true,fadeOut:.1};
  const actual=createPcmMixer([{...settings,renderer}],{sampleRate:11025}).render(0,16000);
  const expected=createPcmMixer([{...settings,pcm}],{sampleRate:11025}).render(0,16000);
  assert.deepEqual(actual,expected);
});
test("external and archived clip documents keep their own resource bases", async () => {
  const child={objectList:[],timeline:{duration:1,audio:[{id:"a",url:"voice.wav"}]}};
  const parent={documentType:"composition",compositionVersion:1,timeline:{clips:[{id:"c",source:"child/scene.json",duration:1}]}};
  const opened=await openMediaDocument(parent,{baseUrl:"https://example.test/project/main.json",fetch:async(url)=>{assert.equal(url,"https://example.test/project/child/scene.json");return new Response(JSON.stringify(child));}});
  const scene=await opened.loadScene("child/scene.json");assert.equal(await opened.ownerOf(scene).resolveAsset("voice.wav"),"https://example.test/project/child/voice.wav");opened.dispose();
  const packedChild=await packMediaDocument(child,{assets:{"voice.wav":new Uint8Array([1,2])}});
  const packedParent=await packMediaDocument({...parent,timeline:{clips:[{id:"c",source:"child.tjz",duration:1}]}},{assets:{"child.tjz":packedChild}});
  const archive=await openMediaDocument(packedParent,{asyncArchive:false}),nested=await archive.loadScene(archive.document.timeline.clips[0].source);
  assert.ok((await archive.ownerOf(nested).resolveAsset(nested.timeline.audio[0].url)).startsWith("blob:"));archive.dispose();
});
test("composition archive roundtrip retains binary assets and resolves a scene without Base64", async () => {
  const scene = { objectList: [], timeline: { duration: 3 } };
  const document = { documentType: "composition", compositionVersion: 1, scenes: { first: scene }, timeline: { duration: 5, clips: [{ id: "a", source: "first", duration: 3 }], audio: [{ id: "song", url: "song.wav", duration: 5 }] } };
  const bytes = await packMediaDocument(document, { assets: { "song.wav": new Uint8Array([1,2,3,4]) } });
  const opened = await openMediaDocument(bytes, { asyncArchive: false });
  assert.equal(opened.document.documentType, "composition"); assert.deepEqual((await opened.loadScene("first")).objectList, []);
  const url = await opened.resolveAsset(opened.document.timeline.audio[0].url); assert.ok(url.startsWith("blob:"));
  assert.deepEqual(new Uint8Array(await (await fetch(url)).arrayBuffer()), new Uint8Array([1,2,3,4]));
  assert.ok(!JSON.stringify(opened.document).includes("base64")); opened.dispose();
});
test("formats, duration and missing encoders fail before any fake output", async () => {
  assert.throws(() => validateMediaDocument({ documentType: "bogus" }));
  assert.throws(() => resolveFrameRange({ duration: 0, document: {} }));
  assert.equal(resolveFrameRange({ duration: 1, document: {} }, { fps: 60 }).frames, 60);
  const project = { width: 10, height: 10, duration: 1, document: {}, canvas: { convertToBlob: async () => new Blob([], { type: "image/png" }) }, renderAt() {}, getAudioClips() { return []; } };
  await assert.rejects(renderImage(project, { type: "image/webp" }), { code: "MEDIA_CODEC_UNAVAILABLE" });
  await assert.rejects(renderVideo(project, { codecs: { canEncodeVideo: async () => false } }), { code: "MEDIA_CODEC_UNAVAILABLE" });
});

test("composition releases inactive renderer configurations instead of accumulating GPU contexts", async () => {
  const live = new Set(), context = { clearRect() {}, fillRect() {}, save() {}, restore() {}, drawImage() {} };
  const canvas = () => ({ getContext: () => context });
  const document = { documentType: "composition", compositionVersion: 1, timeline: { duration: 3, clips: [0,1,2].map(index => ({ id: `clip-${index}`, start: index, duration: 1, source: { sceneConfig: { renderer: { exposure: index + 1 } }, objectList: [] } })) } };
  const project = await createMediaProject(document, { width: 32, height: 32, createCanvas: canvas, createScene: async (_scene, options) => {
    const renderer = options.renderer || { domElement: canvas(), setPixelRatio() {}, setSize() {}, dispose() { live.delete(this); } };
    live.add(renderer); let owned = options.ownsRenderer;
    return { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer, setRendererOwnership(value) { owned = value; }, renderLoop: { setTimeDriver() {}, renderCurrentFrame() {} }, dispose() { if (owned) renderer.dispose(); } };
  } });
  try { for (const time of [.1, 1.1, 2.1, .1]) { await project.renderAt(time); assert.equal(live.size, 1); } }
  finally { project.dispose(); }
  assert.equal(live.size, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { validateTimeline, sampleTimelineSignal, sampleTimelineTrack, createSceneTimelineController, attachSceneTimeline, matchParticlePositions } from "../core/timeline.js";

test("absolute signals and camera paths are reproducible and explicit", () => {
  const signal = { type: "noise", seed: 32, frequency: 3, amplitude: 2 };
  assert.equal(sampleTimelineSignal(signal, 4.125), sampleTimelineSignal(signal, 4.125));
  const orbit = { type: "orbit", center: [1, 2, 3], radius: 4, duration: 4 };
  assert.deepEqual(sampleTimelineSignal(orbit, 0), [5, 2, 3]);
  const path = { type: "path", duration: 2, points: [[0, 0, 0], [1, 2, 3], [4, 5, 6]] };
  assert.deepEqual(sampleTimelineSignal(path, 0), path.points[0]);
  assert.deepEqual(sampleTimelineSignal(path, 2), path.points[2]);
  const track = { start: 2, duration: 4, extrapolation: "loop", signal: orbit };
  assert.equal(sampleTimelineTrack(track, 1), undefined);
  assert.deepEqual(sampleTimelineTrack(track, 2), sampleTimelineTrack(track, 6));
  assert.equal(sampleTimelineTrack({ ...track, extrapolation: "none" }, 7), undefined);
  assert.throws(() => validateTimeline({ tracks: [{ id: "s", target: "$camera", property: "position", signal: { type: "path", duration: 2, points: [[1, 2]] } }] }), /Path/);
  assert.throws(() => validateTimeline({ tracks: [{ id: "s", target: "$camera", property: "position", signal: orbit, keyframes: [] }] }), /not both/);
});

test("camera orbit, renderer, pass and caption bindings restore and never mutate authoring", () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), pass = { strength: 1 }, renderer = { toneMappingExposure: 1 };
  const input = { duration: 4, captions: [{ id: "title", text: "量子", opacity: 1 }], tracks: [
    { id: "orbit", target: "$camera", property: "position", signal: { type: "orbit", duration: 4, radius: 4 } },
    { id: "aim", target: "$camera", property: "lookAt", keyframes: [{ time: 0, value: [0, 0, 0] }] },
    { id: "exposure", target: "$renderer", property: "toneMappingExposure", signal: { type: "constant", value: 2 } },
    { id: "bloom", target: "$pass:bloom", property: "strength", signal: { type: "sine", amplitude: .2, offset: 1 } },
    { id: "caption", target: "$caption:title", property: "opacity", signal: { type: "constant", value: .5 } }
  ] };
  const before = JSON.stringify(input), player = createSceneTimelineController({ scene, camera, renderer, runtimeContext: { scenePassRegistry: { getDeployedPass: () => ({ pass }) } } }, input);
  player.evaluateAt(1); assert.ok(Math.abs(camera.position.z - 4) < 1e-8);
  assert.equal(renderer.toneMappingExposure, 2); assert.equal(player.timeline.captions[0].opacity, .5);
  player.evaluateAt(.25); assert.equal(pass.strength, 1.2);
  assert.equal(JSON.stringify(input), before); player.dispose(); assert.equal(renderer.toneMappingExposure, 1); assert.equal(pass.strength, 1);
});

test("effect parameter tracks address the prepared effect and hold/rewind are deterministic", async () => {
  const scene = new THREE.Scene(), points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
  points.geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3)); points.userData.threeJsonId = "p"; scene.add(points);
  const input = { duration: 6, effects: [{ id: "wave", target: "p", operator: "wave", duration: 2, params: { amplitude: 1, speed: 1 } }], tracks: [
    { id: "amp", target: "$effect:wave", property: "params.amplitude", keyframes: [{ time: 0, value: 1 }, { time: 2, value: 3 }] }
  ] };
  const player = await attachSceneTimeline({ scene }, input, { autoPlay: false });
  player.evaluateAt(2); const result = [...points.geometry.attributes.position.array];
  assert.ok(Math.abs(result[1] - 3 * Math.sin(2)) < 1e-6);
  player.evaluateAt(5); assert.deepEqual([...points.geometry.attributes.position.array], result);
  player.evaluateAt(0); player.evaluateAt(2); assert.deepEqual([...points.geometry.attributes.position.array], result);
  assert.equal(input.effects[0].params.amplitude, 1); player.dispose(); assert.equal(points.frustumCulled, true);
});

test("spatial morph correspondence preserves target points and reduces unnecessary crossings", () => {
  const a = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]), b = new Float32Array([2, 1, 0, 0, 1, 0, 1, 1, 0]);
  assert.deepEqual([...matchParticlePositions(a, b)], [0, 1, 0, 1, 1, 0, 2, 1, 0]);
  assert.equal(matchParticlePositions(a, b, "index"), b);
});

test("particle path flow reuses curve descriptors and seeks a moving trail without integration", async () => {
  const scene = new THREE.Scene(), points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
  points.geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)); points.userData.threeJsonId = "p"; scene.add(points);
  const player = await attachSceneTimeline({ scene }, { duration: 6, effects: [{ id: "flow", target: "p", operator: "flow", duration: 6,
    params: { path: { type: "line", points: [[0, 0, 0], [10, 0, 0]] }, speed: .1, length: .2 } }] }, { autoPlay: false });
  player.evaluateAt(2); const values = [...points.geometry.attributes.position.array];
  assert.ok(Math.abs(values[0] - 2) < 1e-6); assert.ok(Math.abs(values[3] - 4) < 1e-6);
  player.evaluateAt(5); player.evaluateAt(2); assert.deepEqual([...points.geometry.attributes.position.array], values); player.dispose();
});

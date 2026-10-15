import test from "node:test";
import assert from "node:assert/strict";
import { Scene, Points, BufferGeometry, BufferAttribute, PointsMaterial, LOD, Object3D, PerspectiveCamera } from "three";
import { createPreviewPerformance } from "../core/runtime/previewPerformance.js";
import { resolvePreviewPerformance, createHostPreviewPerformance } from "../tools/scene-host/shared/js/previewPerformancePolicy.js";
import { createRenderLoop } from "../core/handler/frameLoopHandler.js";
import { renderImage, renderGif, renderVideo } from "../packages/media-kit/js/export.js";

const makePoints = (count) => new Points(new BufferGeometry().setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3)), new PointsMaterial());
test("preview auto mode uses bounded device hints, independent of creation quality", () => {
  assert.equal(resolvePreviewPerformance("auto", { navigator: { deviceMemory: 4 }, coarsePointer: false }).mode, "economy");
  assert.equal(resolvePreviewPerformance("auto", { navigator: { deviceMemory: 16, hardwareConcurrency: 12 }, coarsePointer: true }).mode, "balanced");
  assert.equal(resolvePreviewPerformance("auto", { navigator: {}, coarsePointer: false }).mode, "full");
  assert.equal(resolvePreviewPerformance().mode, "full");
  assert.throws(() => resolvePreviewPerformance("ultimate"), /Unknown preview/);
});
test("point sampling covers the whole shape, is deterministic and never changes source geometry", () => {
  const policy = createPreviewPerformance(createHostPreviewPerformance("economy", { allowPointSampling: true, allowLod: true })), scene = new Scene(), points = makePoints(100000);
  scene.add(points); const original = points.geometry;
  let samples;
  const draw = () => {
    assert.notEqual(points.geometry, original); assert.equal(original.index, null);
    assert.equal(points.geometry.attributes.position, original.attributes.position);
    const array = Array.from(points.geometry.index.array);
    assert.equal(array.length, 40000); assert.ok(array[0] < 3); assert.ok(array.at(-1) > 99996);
    if (samples) assert.deepEqual(array, samples); else samples = array;
  };
  policy.draw(scene, null, null, null, draw); assert.equal(points.geometry, original);
  policy.draw(scene, null, null, null, draw); assert.equal(points.geometry, original);
  policy.dispose(); original.dispose(); points.material.dispose();
});
test("draw-only budgets preserve indexed draw ranges and unwind on renderer errors", () => {
  const policy = createPreviewPerformance(createHostPreviewPerformance("economy", { allowPointSampling: true, allowLod: true })), scene = new Scene(), points = makePoints(100000);
  const original = points.geometry;
  original.setIndex(Array.from({ length: 100000 }, (_, i) => 99999-i)); original.setDrawRange(10000, 50000); scene.add(points);
  assert.throws(() => policy.draw(scene, null, null, null, () => {
    const index = points.geometry.index.array;
    assert.ok(index[0] <= 89999); assert.ok(index.at(-1) >= 40000);
    throw new Error("GPU lost");
  }), /GPU lost/);
  assert.equal(points.geometry, original); assert.deepEqual(original.drawRange, { start: 10000, count: 50000 });
  policy.dispose(); original.dispose(); points.material.dispose();
});
test("LOD bias is temporary, preserves manual LOD and restores child visibility", () => {
  const scene = new Scene(), lod = new LOD(), camera = new PerspectiveCamera();
  lod.addLevel(new Object3D(), 0); lod.addLevel(new Object3D(), 10); scene.add(lod); camera.position.z = 8;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); lod.update(camera);
  const before = lod.levels.map(l => ({ distance: l.distance, visible: l.object.visible }));
  const policy = createPreviewPerformance(createHostPreviewPerformance("economy", { allowPointSampling: true, allowLod: true }));
  policy.draw(scene, camera, null, null, () => { lod.update(camera); assert.equal(lod.getCurrentLevel(), 1); });
  assert.deepEqual(lod.levels.map(l => ({ distance: l.distance, visible: l.object.visible })), before); assert.equal(lod.getCurrentLevel(), 0);
  lod.autoUpdate = false;
  policy.draw(scene, camera, null, null, () => { assert.equal(lod.levels[1].distance, 10); }); policy.dispose();
});
test("preview caps renderer and composer resolution without disabling authored passes", () => {
  const policy = createPreviewPerformance(createHostPreviewPerformance("economy", { allowPointSampling: true, allowLod: true })); let ratio = 3, composerRatio = 3;
  const renderer = { getSize: v => v.set(1920,1080), getPixelRatio: () => ratio, setPixelRatio: value => { ratio=value; } };
  const passes = [{ enabled:true }], composer = { passes, _pixelRatio:3, setPixelRatio: value => { composerRatio=value; } };
  policy.draw(new Scene(), null, renderer, composer, () => {});
  assert.equal(ratio,.375); assert.equal(composerRatio,.375); assert.equal(passes[0].enabled,true);
  assert.equal(policy.pixelRatio(.25,1920,1080),.25); policy.dispose();
});
test("manual timeline rendering and live playback share draw budgets without advancing time", () => {
  const scene = new Scene(), points=makePoints(100000); scene.add(points); const original=points.geometry;
  let frames=0, advanced=0;
  const loop = createRenderLoop({ scene, camera:new PerspectiveCamera(), previewPerformance:createHostPreviewPerformance("economy", { allowPointSampling: true }), renderer:{ render() { assert.equal(points.geometry.index.count,40000); frames++; } }, config:{ autoResize:false, firstAutoResize:false }, requestFrame:()=>1, cancelFrame:()=>{} });
  loop.setTimeDriver({ advance(){advanced++;} }); loop.renderCurrentFrame();
  assert.equal(advanced,0); assert.equal(points.geometry,original);
  loop.start(); loop.renderOnce(100); assert.equal(advanced,1); assert.equal(frames,2);
  loop.dispose(); original.dispose(); points.material.dispose();
});
test("full quality does not change geometry or resolution", () => {
  const policy=createPreviewPerformance("full"), scene=new Scene(), points=makePoints(100001); scene.add(points); const original=points.geometry;
  policy.draw(scene,null,{ getSize:()=>assert.fail("full export must not be clamped") },null,()=>assert.equal(points.geometry,original));
  assert.equal(policy.pixelRatio(3,3840,2160),3); policy.dispose(); original.dispose(); points.material.dispose();
});
test("image, GIF and video exporters reject reduced preview projects instead of silently exporting draft quality", async () => {
  const project={previewPerformance:"economy",renderAt(){ assert.fail("must not export preview"); }};
  for (const exportMedia of [renderImage,renderGif,renderVideo]) await assert.rejects(exportMedia(project), { code:"PREVIEW_PROJECT_NOT_EXPORTABLE" });
});

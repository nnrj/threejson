import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { compileTimelineTracks } from "../core/timeline/tracks.js";
import { createSceneTimelineController } from "../core/timeline.js";
import { wrapTextForBillboard } from "../core/builder/text/textStyleShared.js";

function setup(object) {
  const scene = new THREE.Scene();
  object.userData.objJson = { threeJsonId: "title", objType: "text" };
  scene.add(object);
  return { scene, camera: new THREE.PerspectiveCamera() };
}
const fade = (property = "material.opacity") => ({
  id: "title-in", target: "title", property,
  keyframes: [{ time: 1, value: 0 }, { time: 2, value: 1 }, { time: 3, value: 0 }]
});

test("billboard text fades through its wrapper and all outline/fill materials", () => {
  const fill = new THREE.MeshBasicMaterial({ color: "white", opacity: .8 });
  // Troika's outline material inherits from its fill material.
  const outline = Object.create(fill);
  outline.opacity = .6; outline.transparent = true;
  const text = new THREE.Mesh(new THREE.PlaneGeometry(), [outline, fill]);
  const wrapper = wrapTextForBillboard(text, { position: { x: 2, y: 4, z: 6 } }, "Title");
  const runtime = setup(wrapper), timeline = { duration: 4, tracks: [fade(), {
    id: "move", target: "title", property: "position.x", keyframes: [{ time: 0, value: 2 }, { time: 4, value: 10 }]
  }] };
  const original = JSON.stringify({ record: wrapper.userData.objJson, timeline });
  const player = createSceneTimelineController(runtime, timeline);
  for (const [time, opacity] of [[1, 0], [1.5, .5], [2, 1], [2.5, .5], [3, 0], [1.5, .5]]) {
    player.evaluateAt(time);
    assert.equal(fill.opacity, opacity); assert.equal(outline.opacity, opacity);
    if (opacity < 1) assert.equal(fill.transparent, true);
    assert.equal(wrapper.position.x, 2 + 2 * time);
    assert.equal(text.position.x, 0); // transforms stay on the authored object
  }
  player.evaluateAt(0);
  assert.equal(fill.opacity, .8); assert.equal(outline.opacity, .6);
  assert.equal(fill.transparent, false); assert.equal(outline.transparent, true);
  assert.equal(JSON.stringify({ record: wrapper.userData.objJson, timeline }), original);
  player.dispose(); text.geometry.dispose(); fill.dispose();
});

test("multi-material meshes support unindexed broadcast and explicit material slots", () => {
  const materials = [new THREE.MeshBasicMaterial({ opacity: .8 }), new THREE.MeshBasicMaterial({ opacity: .9 })];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), materials), runtime = setup(mesh);
  const all = compileTimelineTracks(runtime, [fade()]);
  all.evaluate(1.5); assert.deepEqual(materials.map(m => m.opacity), [.5, .5]);
  all.restore(); assert.deepEqual(materials.map(m => m.opacity), [.8, .9]);
  const slot = compileTimelineTracks(runtime, [fade("material.1.opacity")]);
  slot.evaluate(1.5); assert.deepEqual(materials.map(m => m.opacity), [.8, .5]);
  slot.restore(); assert.deepEqual(materials.map(m => m.opacity), [.8, .9]);
  mesh.geometry.dispose(); materials.forEach(m => m.dispose());
});

test("material-less groups bind nested materials without touching unrelated objects", () => {
  const group = new THREE.Group(), nested = new THREE.Group(), geometry = new THREE.BoxGeometry();
  const a = new THREE.MeshBasicMaterial({ color: "red" }), b = new THREE.MeshStandardMaterial({ color: "blue" });
  nested.add(new THREE.Mesh(geometry, a), new THREE.Mesh(geometry, b));
  group.add(nested, new THREE.Mesh(geometry, a));
  const runtime = setup(group), other = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: "green" }));
  runtime.scene.add(other);
  const tracks = compileTimelineTracks(runtime, [{ id: "tint", target: "title", property: "material.color", keyframes: [{ time: 0, value: "red" }, { time: 2, value: "blue" }] }]);
  tracks.evaluate(1);
  assert.equal(a.color.r, .5); assert.equal(b.color.r, .5); assert.equal(a.color.b, .5);
  assert.equal(other.material.color.getHex(), new THREE.Color("green").getHex());
  tracks.restore(); assert.equal(a.color.getHex(), 0xff0000); assert.equal(b.color.getHex(), 0x0000ff);
  geometry.dispose(); [a, b, other.material].forEach(m => m.dispose());
});

test("a mesh material path does not broadcast to the mesh's authored children", () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial(), childMaterial = material.clone();
  const mesh = new THREE.Mesh(geometry, material), child = new THREE.Mesh(geometry, childMaterial);
  mesh.add(child);
  const tracks = compileTimelineTracks(setup(mesh), [fade()]); tracks.evaluate(1.5);
  assert.equal(material.opacity, .5); assert.equal(childMaterial.opacity, 1);
  geometry.dispose(); material.dispose(); childMaterial.dispose();
});

test("invalid material paths remain errors and identify the track and authored target", () => {
  const material = new THREE.MeshBasicMaterial(), geometry = new THREE.BoxGeometry();
  const mesh = new THREE.Mesh(geometry, material), runtime = setup(mesh);
  for (const property of ["material.opactiy", "material.5.opacity", "material.opacity.value"]) {
    assert.throws(() => compileTimelineTracks(runtime, [fade(property)]), error => {
      assert.equal(error.code, "TIMELINE_PROPERTY_MISSING");
      assert.equal(error.trackId, "title-in"); assert.equal(error.targetId, "title");
      assert.equal(error.property, property); assert.equal(error.objectType, "text");
      assert.match(error.message, /title-in/); assert.match(error.message, /title/);
      return true;
    });
  }
  assert.throws(() => compileTimelineTracks(setup(new THREE.Group()), [fade()]), { code: "TIMELINE_PROPERTY_MISSING" });
  assert.throws(() => compileTimelineTracks(runtime, [fade("material.__proto__.opacity")]), { code: "INVALID_TIMELINE_PROPERTY" });
  assert.equal(material.opacity, 1); assert.equal(material.transparent, false);
  geometry.dispose(); material.dispose();
});

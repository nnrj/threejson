import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  bindThreeJsonSceneAudioUnlock,
  detachThreeJsonAudioListener,
  disposeThreeJsonAudioNode,
  getThreeJsonSceneAudioSessionId,
  invalidateThreeJsonSceneAudioSession,
  resolveAudioUrl,
  setThreeJsonSceneAudioPlaybackPolicy,
  teardownThreeJsonSceneAudioFromRuntime
} from "../core/builder/audioBuilder.js";
import { applyAssetsBaseForLoad } from "../core/util/assetsBase.js";

function audioFixture() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const context = { state: "suspended", resumes: 0, resume() {
    this.resumes += 1;
    this.state = "running";
    return Promise.resolve();
  } };
  camera.userData.threeJsonAudioListener = { type: "AudioListener", context };
  const sound = new THREE.Object3D();
  sound.type = "Audio";
  sound.userData = { threeJsonSceneAudio: true, objJson: { autoplay: true } };
  sound.plays = 0;
  sound.play = () => { sound.plays++; sound.isPlaying = true; };
  camera.add(sound);
  setThreeJsonSceneAudioPlaybackPolicy({ paused: false }, scene);
  return { scene, camera, context, sound };
}

const settleUnlock = () => new Promise((resolve) => setImmediate(resolve));

describe("scene audio gesture unlock", () => {
  it("an early gesture before runtime creation does not consume the later unlock", async () => {
    const target = new EventTarget();
    let runtime;
    const dispose = bindThreeJsonSceneAudioUnlock(target, () => runtime);
    target.dispatchEvent(new Event("pointerdown"));
    runtime = audioFixture();
    target.dispatchEvent(new Event("pointerdown"));
    assert.equal(runtime.context.resumes, 1, "resume must run inside the gesture, before awaiting");
    await settleUnlock();
    assert.equal(runtime.sound.plays, 1);
    dispose();
  });

  it("retries rejected and synchronously thrown resume calls without unhandled rejections", async () => {
    const target = new EventTarget();
    const runtime = audioFixture();
    const resume = runtime.context.resume;
    let attempts = 0;
    runtime.context.resume = function () {
      attempts++;
      if (attempts === 1) throw new Error("temporarily unavailable");
      if (attempts === 2) return Promise.reject(new Error("gesture rejected"));
      return resume.call(this);
    };
    const dispose = bindThreeJsonSceneAudioUnlock(target, () => runtime);
    for (let i = 0; i < 3; i++) {
      target.dispatchEvent(new Event("pointerdown"));
      await settleUnlock();
    }
    assert.equal(attempts, 3);
    assert.equal(runtime.sound.plays, 1);
    dispose();
  });

  it("recovers interrupted contexts even when Three.Audio already reports isPlaying", async () => {
    const target = new EventTarget();
    const runtime = audioFixture();
    runtime.sound.isPlaying = true;
    runtime.context.state = "interrupted";
    const dispose = bindThreeJsonSceneAudioUnlock(target, () => runtime);
    target.dispatchEvent(new Event("keydown"));
    await settleUnlock();
    assert.equal(runtime.context.resumes, 1);
    assert.equal(runtime.context.state, "running");
    assert.equal(runtime.sound.plays, 0, "do not restart an already scheduled track");
    dispose();
  });

  it("does not resume explicitly paused audio or play non-autoplay tracks", async () => {
    const target = new EventTarget();
    const runtime = audioFixture();
    const dispose = bindThreeJsonSceneAudioUnlock(target, () => runtime);
    setThreeJsonSceneAudioPlaybackPolicy({ paused: true }, runtime.scene);
    target.dispatchEvent(new Event("pointerdown"));
    await settleUnlock();
    assert.equal(runtime.context.resumes, 0);
    setThreeJsonSceneAudioPlaybackPolicy({ paused: false }, runtime.scene);
    runtime.sound.userData.objJson.autoplay = false;
    target.dispatchEvent(new Event("pointerdown"));
    await settleUnlock();
    assert.equal(runtime.context.resumes, 1);
    assert.equal(runtime.sound.plays, 0);
    dispose();
  });

  for (const invalidation of ["replacement", "teardown", "pause", "dispose"]) {
    it(`ignores a pending resume after ${invalidation}`, async () => {
      const target = new EventTarget();
      const original = audioFixture();
      let current = original;
      let finish;
      original.context.resume = () => new Promise((resolve) => { finish = resolve; });
      const dispose = bindThreeJsonSceneAudioUnlock(target, () => current);
      target.dispatchEvent(new Event("pointerdown"));
      if (invalidation === "replacement") current = audioFixture();
      if (invalidation === "teardown") invalidateThreeJsonSceneAudioSession(original.scene);
      if (invalidation === "pause") setThreeJsonSceneAudioPlaybackPolicy({ paused: true }, original.scene);
      if (invalidation === "dispose") dispose();
      original.context.state = "running";
      finish();
      await settleUnlock();
      assert.equal(original.sound.plays, 0);
      dispose();
      setThreeJsonSceneAudioPlaybackPolicy({ paused: false }, original.scene);
    });
  }

  it("updates a repeated binding and can be disposed and rebound without stale listeners", async () => {
    const target = new EventTarget();
    const first = audioFixture();
    const second = audioFixture();
    const dispose = bindThreeJsonSceneAudioUnlock(target, () => first);
    assert.equal(bindThreeJsonSceneAudioUnlock(target, () => second), dispose);
    target.dispatchEvent(new Event("pointerdown"));
    await settleUnlock();
    assert.equal(first.context.resumes, 0);
    assert.equal(second.sound.plays, 1);
    dispose();
    second.context.state = "suspended";
    target.dispatchEvent(new Event("keydown"));
    await settleUnlock();
    assert.equal(second.context.resumes, 1);
    const cleanup = bindThreeJsonSceneAudioUnlock(target, () => first);
    target.dispatchEvent(new Event("pointerdown"));
    await settleUnlock();
    assert.equal(first.sound.plays, 1);
    cleanup();
  });
});

describe("audioBuilder session", () => {
  it("invalidateThreeJsonSceneAudioSession increments id", () => {
    const before = getThreeJsonSceneAudioSessionId();
    const after = invalidateThreeJsonSceneAudioSession();
    assert.equal(after, before + 1);
    assert.equal(getThreeJsonSceneAudioSessionId(), after);
  });
});

describe("detachThreeJsonAudioListener", () => {
  it("removes listener from camera userData and children", () => {
    const camera = new THREE.PerspectiveCamera();
    const listener = new THREE.Object3D();
    listener.type = "AudioListener";
    listener.context = { state: "running", suspend: () => Promise.resolve() };
    camera.userData.threeJsonAudioListener = listener;
    camera.add(listener);

    detachThreeJsonAudioListener(camera);

    assert.equal(camera.userData.threeJsonAudioListener, undefined);
    assert.equal(camera.children.length, 0);
  });
});

describe("disposeThreeJsonAudioNode", () => {
  it("recognizes THREE.Audio by type (not isAudio)", () => {
    const sound = new THREE.Object3D();
    sound.type = "Audio";
    sound.isPlaying = false;
    sound.stop = () => {
      sound.isPlaying = false;
    };
    sound.disconnect = () => {};
    assert.equal(disposeThreeJsonAudioNode(sound), true);
    assert.equal(disposeThreeJsonAudioNode(new THREE.Object3D()), false);
  });
});

describe("resolveAudioUrl", () => {
  it("rewrites /assets audio paths through active assetsBase", () => {
    const restoreAssetsBase = applyAssetsBaseForLoad({}, { assetsBase: "./assets" });
    try {
      assert.equal(
        resolveAudioUrl({ audioUrl: "/assets/audio/farewell.mp3" }),
        "./assets/audio/farewell.mp3"
      );
      assert.equal(
        resolveAudioUrl({ url: "/assets/audio/ambient_loop.mp3" }),
        "./assets/audio/ambient_loop.mp3"
      );
    } finally {
      restoreAssetsBase();
    }
  });
});

describe("setThreeJsonSceneAudioPlaybackPolicy", () => {
  it("stores paused and masterVolume for async deploy", () => {
    setThreeJsonSceneAudioPlaybackPolicy({ paused: true, masterVolume: 0 });
    setThreeJsonSceneAudioPlaybackPolicy({ paused: false, masterVolume: 0.5 });
  });
});

describe("teardownThreeJsonSceneAudioFromRuntime", () => {
  it("invalidates session even when runtime is null", () => {
    const before = getThreeJsonSceneAudioSessionId();
    teardownThreeJsonSceneAudioFromRuntime(null);
    assert.equal(getThreeJsonSceneAudioSessionId(), before + 1);
  });
});

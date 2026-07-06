import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  detachThreeJsonAudioListener,
  disposeThreeJsonAudioNode,
  getThreeJsonSceneAudioSessionId,
  invalidateThreeJsonSceneAudioSession,
  resolveAudioUrl,
  setThreeJsonSceneAudioPlaybackPolicy,
  teardownThreeJsonSceneAudioFromRuntime
} from "../core/builder/audioBuilder.js";
import { applyAssetsBaseForLoad } from "../core/util/assetsBase.js";

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

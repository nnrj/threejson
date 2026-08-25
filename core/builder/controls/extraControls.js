import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { ArcballControls } from "three/examples/jsm/controls/ArcballControls.js";
import { registerControlsType } from "../controlsBuilder.js";

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function applyTarget(controls, value) {
  if (controls.target?.set) controls.target.set(finite(value?.x, 0), finite(value?.y, 0), finite(value?.z, 0));
}

function createMap(camera, domElement, config = {}) {
  const controls = new MapControls(camera, domElement);
  controls.enableDamping = config.enableDamping !== false;
  controls.dampingFactor = finite(config.dampingFactor, 0.08);
  controls.enableZoom = config.enableZoom !== false;
  controls.enablePan = config.enablePan !== false;
  controls.autoRotate = config.autoRotate === true;
  applyTarget(controls, config.target);
  controls.threeJsonControlsKind = "map";
  controls.update();
  return controls;
}

function createTrackball(camera, domElement, config = {}) {
  const controls = new TrackballControls(camera, domElement);
  controls.rotateSpeed = finite(config.rotateSpeed, controls.rotateSpeed);
  controls.zoomSpeed = finite(config.zoomSpeed, controls.zoomSpeed);
  controls.panSpeed = finite(config.panSpeed, controls.panSpeed);
  controls.dynamicDampingFactor = finite(config.dampingFactor ?? config.dynamicDampingFactor, controls.dynamicDampingFactor);
  controls.staticMoving = config.enableDamping === false;
  controls.noZoom = config.enableZoom === false;
  controls.noPan = config.enablePan === false;
  applyTarget(controls, config.target);
  controls.threeJsonControlsKind = "trackball";
  controls.update();
  return controls;
}

function createArcball(camera, domElement, config = {}, ctx = {}) {
  const controls = new ArcballControls(camera, domElement, ctx.scene ?? null);
  controls.enableAnimations = config.enableDamping !== false && config.enableAnimations !== false;
  controls.dampingFactor = finite(config.dampingFactor, controls.dampingFactor);
  controls.wMax = finite(config.wMax, controls.wMax);
  controls.enablePan = config.enablePan !== false;
  controls.enableRotate = config.enableRotate !== false;
  controls.enableZoom = config.enableZoom !== false;
  applyTarget(controls, config.target);
  if (typeof controls.setGizmosVisible === "function") controls.setGizmosVisible(config.gizmosVisible === true);
  controls.threeJsonControlsKind = "arcball";
  controls.update();
  return controls;
}

let registered = false;
export function ensureExtraControlsRegistered() {
  if (registered) return;
  registerControlsType("map", createMap);
  registerControlsType("trackball", createTrackball);
  registerControlsType("arcball", createArcball);
  registered = true;
}

ensureExtraControlsRegistered();

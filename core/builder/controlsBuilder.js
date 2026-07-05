import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { log } from "../util/logger.js";
import { FlyControls } from "three/examples/jsm/controls/FlyControls.js";
import { createFirstPersonControls } from "../handler/controls/firstPersonControls.js";

/** @type {Map<string, Function>} */
const customFactories = new Map();

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function getValue(source, key, defaultValue) {
  return source && hasOwn(source, key) ? source[key] : defaultValue;
}

function toVector3(value, defaultValue = { x: 0, y: 0, z: 0 }) {
  return {
    x: getValue(value, "x", defaultValue.x),
    y: getValue(value, "y", defaultValue.y),
    z: getValue(value, "z", defaultValue.z)
  };
}

/**
 * @param {object} [config]
 * @returns {string}
 */
export function resolveControlsType(config = {}) {
  const raw = typeof config.type === "string" ? config.type.trim() : "";
  if (!raw || raw.toLowerCase() === "orbit") {
    return "orbit";
  }
  return raw;
}

/**
 * @param {string} type
 * @param {(camera: import("three").PerspectiveCamera, domElement: HTMLElement, config: object, ctx: object) => object} factory
 */
export function registerControlsType(type, factory) {
  const key = typeof type === "string" ? type.trim() : "";
  if (!key) {
    throw new Error("registerControlsType: type must not be empty");
  }
  customFactories.set(key, factory);
}

function createFlyControls(camera, domElement, controlsConfig = {}) {
  const controls = new FlyControls(camera, domElement);
  controls.movementSpeed = Number.isFinite(controlsConfig.movementSpeed)
    ? controlsConfig.movementSpeed
    : Number.isFinite(controlsConfig.moveSpeed)
      ? controlsConfig.moveSpeed
      : 10;
  controls.rollSpeed = Number.isFinite(controlsConfig.rollSpeed) ? controlsConfig.rollSpeed : 0.5;
  controls.dragToLook = controlsConfig.dragToLook !== false;
  controls.threeJsonControlsKind = "fly";
  return controls;
}

function createOrbitControls(camera, domElement, controlsConfig = {}) {
  const controls = new OrbitControls(camera, domElement);
  if (controlsConfig.listenToKeyEvents) {
    controls.listenToKeyEvents(typeof window !== "undefined" ? window : domElement);
  }
  controls.enableDamping = getValue(controlsConfig, "enableDamping", true);
  controls.dampingFactor = getValue(controlsConfig, "dampingFactor", 0.08);
  controls.enableZoom = getValue(controlsConfig, "enableZoom", true);
  controls.autoRotate = getValue(controlsConfig, "autoRotate", false);
  controls.enablePan = getValue(controlsConfig, "enablePan", controls.enablePan);
  if (Number.isFinite(controlsConfig.minDistance)) {
    controls.minDistance = controlsConfig.minDistance;
  }
  if (Number.isFinite(controlsConfig.maxDistance)) {
    controls.maxDistance = controlsConfig.maxDistance;
  }
  if (Number.isFinite(controlsConfig.maxPolarAngle)) {
    controls.maxPolarAngle = controlsConfig.maxPolarAngle;
  }
  const target = toVector3(controlsConfig.target, { x: 0, y: 0, z: 0 });
  controls.target.set(target.x, target.y, target.z);
  controls.threeJsonControlsKind = "orbit";
  return controls;
}

/**
 * @param {import("three").PerspectiveCamera} camera
 * @param {HTMLElement} domElement
 * @param {object} [controlsConfig]
 * @param {{ scene?: import("three").Scene, movementRoot?: import("three").Object3D }} [ctx]
 * @returns {object|null}
 */
export function createControlsFromDescriptor(camera, domElement, controlsConfig = {}, ctx = {}) {
  if (controlsConfig.enabled === false) {
    return null;
  }
  const type = resolveControlsType(controlsConfig);
  if (type === "orbit") {
    return createOrbitControls(camera, domElement, controlsConfig);
  }
  if (type === "firstPerson") {
    return createFirstPersonControls(camera, domElement, controlsConfig, ctx);
  }
  if (type === "fly") {
    return createFlyControls(camera, domElement, controlsConfig);
  }
  const custom = customFactories.get(type);
  if (custom) {
    return custom(camera, domElement, controlsConfig, ctx);
  }
  log.warn(`[controlsBuilder] Unknown controls.type="${type}", falling back to orbit`);
  return createOrbitControls(camera, domElement, controlsConfig);
}

/**
 * @param {object|null} controls
 * @param {object} [config]
 */
export function applyControlsConfig(controls, config = {}) {
  if (!controls) {
    return;
  }
  const kind = controls.threeJsonControlsKind || resolveControlsType(config);

  if (config.enabled === false) {
    controls.enabled = false;
    return;
  }
  if (hasOwn(config, "enabled")) {
    controls.enabled = config.enabled !== false;
  }

  if (kind === "firstPerson") {
    if (Number.isFinite(config.moveSpeed)) {
      controls.moveSpeed = config.moveSpeed;
    }
    if (Number.isFinite(config.eyeHeight)) {
      controls.eyeHeight = config.eyeHeight;
    }
    if (typeof controls.applyLookConfig === "function") {
      controls.applyLookConfig(config);
      if (Number.isFinite(config.lookSensitivity)) {
        controls.lookSensitivity = config.lookSensitivity;
      }
      if (Number.isFinite(config.lookSmoothing)) {
        controls.lookSmoothing = config.lookSmoothing;
      }
    }
    controls.update?.();
    return;
  }

  if (kind === "fly") {
    if (Number.isFinite(config.movementSpeed)) {
      controls.movementSpeed = config.movementSpeed;
    }
    if (Number.isFinite(config.moveSpeed)) {
      controls.movementSpeed = config.moveSpeed;
    }
    if (Number.isFinite(config.rollSpeed)) {
      controls.rollSpeed = config.rollSpeed;
    }
    if (hasOwn(config, "dragToLook")) {
      controls.dragToLook = Boolean(config.dragToLook);
    }
    return;
  }

  controls.enableDamping = hasOwn(config, "enableDamping") ? Boolean(config.enableDamping) : controls.enableDamping;
  if (Number.isFinite(config.dampingFactor)) {
    controls.dampingFactor = config.dampingFactor;
  }
  if (hasOwn(config, "enableZoom")) {
    controls.enableZoom = Boolean(config.enableZoom);
  }
  if (hasOwn(config, "autoRotate")) {
    controls.autoRotate = Boolean(config.autoRotate);
  }
  if (hasOwn(config, "enablePan")) {
    controls.enablePan = Boolean(config.enablePan);
  }
  if (Number.isFinite(config.minDistance)) {
    controls.minDistance = config.minDistance;
  }
  if (Number.isFinite(config.maxDistance)) {
    controls.maxDistance = config.maxDistance;
  }
  if (Number.isFinite(config.maxPolarAngle)) {
    controls.maxPolarAngle = config.maxPolarAngle;
  }
  if (controls.target && typeof controls.target.set === "function") {
    const target = toVector3(config.target, { x: 0, y: 0, z: 0 });
    controls.target.set(target.x, target.y, target.z);
  }
  controls.update?.();
}

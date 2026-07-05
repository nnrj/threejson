import { OrthographicCamera, PerspectiveCamera } from "three";

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function toVector3(value, defaultValue = { x: 0, y: 0, z: 0 }) {
  return {
    x: hasOwn(value, "x") ? Number(value.x) : defaultValue.x,
    y: hasOwn(value, "y") ? Number(value.y) : defaultValue.y,
    z: hasOwn(value, "z") ? Number(value.z) : defaultValue.z
  };
}

/**
 * Resize orthographic camera frustum to canvas aspect ratio, preserving world-space height (not pixels as world units).
 * @param {import("three").OrthographicCamera} camera
 * @param {number} width
 * @param {number} height
 */
export function resizeOrthographicCameraToAspect(camera, width, height) {
  if (!camera?.isOrthographicCamera) {
    return;
  }
  const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
  const worldHeight = Math.abs(camera.top - camera.bottom);
  const halfH = worldHeight > 0 ? worldHeight / (2 * zoom) : 50;
  const aspect = Math.max(Number(width) || 1, 1) / Math.max(Number(height) || 1, 1);
  camera.left = -halfH * aspect;
  camera.right = halfH * aspect;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}

/**
 * @param {import("three").Camera} camera
 * @param {object} [config]
 */
function applyCameraOrientation(camera, config = {}) {
  if (!camera) {
    return;
  }
  const lookAt = config.lookAt && typeof config.lookAt === "object" ? config.lookAt : null;
  if (lookAt) {
    const target = toVector3(lookAt, { x: 0, y: 0, z: 0 });
    camera.lookAt(target.x, target.y, target.z);
    return;
  }
  const rotSource =
    config.rotation && typeof config.rotation === "object" && !Array.isArray(config.rotation)
      ? config.rotation
      : config;
  const rx = Number.isFinite(rotSource.rotationX)
    ? rotSource.rotationX
    : Number.isFinite(rotSource.x)
      ? rotSource.x
      : null;
  const ry = Number.isFinite(rotSource.rotationY)
    ? rotSource.rotationY
    : Number.isFinite(rotSource.y)
      ? rotSource.y
      : null;
  const rz = Number.isFinite(rotSource.rotationZ)
    ? rotSource.rotationZ
    : Number.isFinite(rotSource.z)
      ? rotSource.z
      : null;
  if (rx !== null || ry !== null || rz !== null) {
    camera.rotation.set(
      rx !== null ? rx : camera.rotation.x,
      ry !== null ? ry : camera.rotation.y,
      rz !== null ? rz : camera.rotation.z
    );
  }
}

/**
 * @param {object} [config]
 * @returns {"perspective"|"orthographic"}
 */
export function resolveCameraType(config = {}) {
  const raw = typeof config.type === "string" ? config.type.trim().toLowerCase() : "";
  if (raw === "orthographic" || raw === "ortho") {
    return "orthographic";
  }
  return "perspective";
}

/**
 * @param {object} [cameraConfig]
 * @param {number} [width]
 * @param {number} [height]
 * @returns {import("three").PerspectiveCamera|import("three").OrthographicCamera}
 */
export function createCameraFromDescriptor(cameraConfig = {}, width = 1, height = 1) {
  const w = Math.max(Number(width) || 1, 1);
  const h = Math.max(Number(height) || 1, 1);
  const near = Number.isFinite(cameraConfig.near) ? cameraConfig.near : 0.1;
  const far = Number.isFinite(cameraConfig.far) ? cameraConfig.far : 2500;
  const position = toVector3(cameraConfig.position, { x: 0, y: 0, z: 5 });

  if (resolveCameraType(cameraConfig) === "orthographic") {
    const zoom = Number.isFinite(cameraConfig.zoom) ? cameraConfig.zoom : 1;
    const aspect = w / h;
    const hasExplicitBounds =
      Number.isFinite(cameraConfig.left) &&
      Number.isFinite(cameraConfig.right) &&
      Number.isFinite(cameraConfig.top) &&
      Number.isFinite(cameraConfig.bottom);
    const halfH = hasExplicitBounds
      ? Math.abs(cameraConfig.top - cameraConfig.bottom) / 2
      : 50;
    const halfW = hasExplicitBounds
      ? Math.abs(cameraConfig.right - cameraConfig.left) / 2
      : halfH * aspect;
    const left = Number.isFinite(cameraConfig.left) ? cameraConfig.left : -halfW;
    const right = Number.isFinite(cameraConfig.right) ? cameraConfig.right : halfW;
    const top = Number.isFinite(cameraConfig.top) ? cameraConfig.top : halfH;
    const bottom = Number.isFinite(cameraConfig.bottom) ? cameraConfig.bottom : -halfH;
    const camera = new OrthographicCamera(left, right, top, bottom, near, far);
    camera.position.set(position.x, position.y, position.z);
    if (Number.isFinite(cameraConfig.zoom)) {
      camera.zoom = cameraConfig.zoom;
    }
    applyCameraOrientation(camera, cameraConfig);
    camera.updateProjectionMatrix();
    return camera;
  }

  const camera = new PerspectiveCamera(
    Number.isFinite(cameraConfig.fov) ? cameraConfig.fov : 60,
    w / h,
    near,
    far
  );
  camera.position.set(position.x, position.y, position.z);
  applyCameraOrientation(camera, cameraConfig);
  camera.updateProjectionMatrix();
  return camera;
}

/**
 * @param {import("three").Camera} camera
 * @param {object} [config]
 * @param {{ width?: number, height?: number }} [sizeHint]
 */
export function applyCameraDescriptor(camera, config = {}, sizeHint = {}) {
  if (!camera) {
    return;
  }
  const near = Number.isFinite(config.near) ? config.near : undefined;
  const far = Number.isFinite(config.far) ? config.far : undefined;
  if (near !== undefined) {
    camera.near = near;
  }
  if (far !== undefined) {
    camera.far = far;
  }
  const position = toVector3(config.position, { x: 0, y: 0, z: 5 });
  camera.position.set(position.x, position.y, position.z);

  const width = Math.max(Number(sizeHint.width) || 1, 1);
  const height = Math.max(Number(sizeHint.height) || 1, 1);

  if (camera.isOrthographicCamera) {
    if (Number.isFinite(config.left)) {
      camera.left = config.left;
    }
    if (Number.isFinite(config.right)) {
      camera.right = config.right;
    }
    if (Number.isFinite(config.top)) {
      camera.top = config.top;
    }
    if (Number.isFinite(config.bottom)) {
      camera.bottom = config.bottom;
    }
    if (Number.isFinite(config.zoom)) {
      camera.zoom = config.zoom;
    }
    applyCameraOrientation(camera, config);
    if (sizeHint.width && sizeHint.height) {
      resizeOrthographicCameraToAspect(camera, sizeHint.width, sizeHint.height);
    } else {
      camera.updateProjectionMatrix();
    }
    return;
  }

  if (Number.isFinite(config.fov)) {
    camera.fov = config.fov;
  }
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  applyCameraOrientation(camera, config);
}

export { applyCameraOrientation };

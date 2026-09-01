import * as THREE from "three";

const VIEW_DIRECTIONS = Object.freeze({
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(1, 0, 0),
  left: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
  perspective: new THREE.Vector3(1, 0.72, 1).normalize()
});

function normalizedDimension(value, fallback = 384) {
  const numeric = Math.round(Number(value));
  // This is a review-image resolution, not a mesh complexity budget. Clamp it to the practical
  // WebGL render-target range so an erroneous model request cannot allocate an enormous scratch
  // framebuffer in the host application.
  return Number.isFinite(numeric) && numeric > 0 ? Math.min(2048, numeric) : fallback;
}

function removeEditorOnlyNodes(root) {
  const remove = [];
  root.traverse((object) => {
    if (object !== root && object.userData?.editorOnly === true) remove.push(object);
  });
  for (const object of remove) object.removeFromParent();
}

function cloneAtWorldTransform(object3D) {
  object3D.updateWorldMatrix(true, true);
  const clone = object3D.clone(true);
  clone.matrix.copy(object3D.matrixWorld);
  clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
  clone.matrixAutoUpdate = true;
  removeEditorOnlyNodes(clone);
  return clone;
}

function pixelsToDataUrl(pixels, width, height, mimeType, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("The browser could not create a 2D canvas for mesh review views.");
  const image = context.createImageData(width, height);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (height - y - 1) * rowBytes;
    image.data.set(pixels.subarray(sourceStart, sourceStart + rowBytes), y * rowBytes);
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL(mimeType, quality);
}

/**
 * Capture isolated model views without resizing or repainting the visible host canvas. The host
 * decides whether to expose this callback to core commands; core itself never imports DOM/canvas.
 */
export async function captureMeshReviewViews({
  object3D,
  renderer,
  views = ["front", "right", "back", "top", "perspective"],
  size,
  background = "#20242b",
  mimeType = "image/jpeg",
  quality = 0.86
} = {}) {
  if (!object3D?.isObject3D) throw new Error("Mesh review capture requires an Object3D.");
  if (!renderer?.isWebGLRenderer || typeof renderer.readRenderTargetPixels !== "function") {
    throw new Error("Mesh review capture currently requires a WebGLRenderer host.");
  }
  const width = normalizedDimension(typeof size === "object" ? size?.width : size);
  const height = normalizedDimension(typeof size === "object" ? size?.height : size, width);
  const previewScene = new THREE.Scene();
  previewScene.background = new THREE.Color(background);
  const clone = cloneAtWorldTransform(object3D);
  previewScene.add(clone);
  const bounds = new THREE.Box3().setFromObject(clone);
  if (bounds.isEmpty()) throw new Error("The selected mesh has no renderable bounds.");
  const center = bounds.getCenter(new THREE.Vector3());
  const extent = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(0.001, extent.length() * 0.5);
  const distance = radius / Math.tan(THREE.MathUtils.degToRad(35 * 0.5)) * 1.18;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 1.7);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.copy(center).add(new THREE.Vector3(1.8, 2.4, 2.1).multiplyScalar(radius));
  previewScene.add(hemi, key);

  const target = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false
  });
  target.texture.colorSpace = renderer.outputColorSpace || THREE.SRGBColorSpace;
  const pixels = new Uint8Array(width * height * 4);
  const previousTarget = renderer.getRenderTarget();
  const previousClearColor = renderer.getClearColor(new THREE.Color()).clone();
  const previousClearAlpha = renderer.getClearAlpha();
  const previousXrEnabled = renderer.xr?.enabled;
  const captured = [];
  try {
    if (renderer.xr) renderer.xr.enabled = false;
    renderer.setRenderTarget(target);
    renderer.setClearColor(previewScene.background, 1);
    for (const rawName of Array.isArray(views) && views.length ? views : ["perspective"]) {
      const name = String(rawName || "perspective").trim().toLowerCase();
      const direction = (VIEW_DIRECTIONS[name] || VIEW_DIRECTIONS.perspective).clone();
      const camera = new THREE.PerspectiveCamera(35, width / height, Math.max(0.001, distance - radius * 2.5), distance + radius * 3.5);
      camera.position.copy(center).addScaledVector(direction, distance);
      if (name === "top" || name === "bottom") camera.up.set(0, 0, name === "top" ? -1 : 1);
      camera.lookAt(center);
      camera.updateMatrixWorld(true);
      renderer.clear(true, true, true);
      renderer.render(previewScene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      captured.push({
        name,
        width,
        height,
        detail: "low",
        dataUrl: pixelsToDataUrl(pixels, width, height, mimeType, quality)
      });
    }
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    if (renderer.xr && previousXrEnabled !== undefined) renderer.xr.enabled = previousXrEnabled;
    target.dispose();
    previewScene.clear();
  }
  return { views: captured };
}

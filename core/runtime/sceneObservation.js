import { documentError } from "../document/sceneDocument.js";

/** Inspect render inputs, not a guessed verdict based on average pixel brightness. */
export function observeSceneRuntime(runtime) {
  if (!runtime?.scene) return { available: false, render: "unchecked", resources: "unchecked" };
  const lights = [], visibleMeshes = [];
  runtime.scene.traverse((object) => {
    let visible = object.visible, parent = object.parent;
    while (parent && visible) { visible = parent.visible; parent = parent.parent; }
    if (object.isLight) lights.push({ type: object.type, intensity: object.intensity, visible, color: object.color?.getHexString?.() });
    if (visible && (object.isMesh || object.isPoints || object.isLine) && !object.userData?.editorOnly) visibleMeshes.push(object);
  });
  const diagnostics = runtime.runtimeContext?.diagnostics?.snapshot?.() || [];
  return { available: true, lights, visibleObjectCount: visibleMeshes.length,
    environment: Boolean(runtime.scene.environment), background: runtime.scene.background?.isColor ? `#${runtime.scene.background.getHexString()}` : runtime.scene.background ? "texture" : null,
    toneMapping: runtime.renderer?.toneMapping, exposure: runtime.renderer?.toneMappingExposure,
    camera: runtime.camera ? { type: runtime.camera.type, position: runtime.camera.position.toArray(), quaternion: runtime.camera.quaternion.toArray(), near: runtime.camera.near, far: runtime.camera.far, zoom: runtime.camera.zoom } : null,
    resources: { status: diagnostics.some((item) => /RESOURCE_FAILED/.test(item.code)) ? "degraded" : "not-proven-ready", diagnostics },
    warnings: [
      ...(!visibleMeshes.length ? [{ code: "NO_VISIBLE_GEOMETRY", message: "No visible mesh, points or line objects were found." }] : []),
      ...(!lights.some((light) => light.visible && light.intensity > 0) && !runtime.scene.environment && visibleMeshes.some((mesh) => [].concat(mesh.material || []).some((material) => material.isMeshStandardMaterial || material.isMeshPhongMaterial || material.isMeshLambertMaterial))
        ? [{ code: "NO_EFFECTIVE_SCENE_LIGHT", message: "Lit materials have no active light or environment. This is diagnostic evidence, not an automatic relighting instruction." }] : [])
    ] };
}

/** Capture the real compositor output, without extra light or material substitution. */
export async function captureSceneFrame(runtime, options = {}) {
  const canvas = runtime?.renderer?.domElement;
  if (!canvas || typeof canvas.toDataURL !== "function" || typeof runtime.renderOnce !== "function") throw documentError("CAPTURE_UNAVAILABLE", "A host renderer and canvas capture are required.");
  options.signal?.throwIfAborted();
  if (!(canvas.width > 0 && canvas.height > 0)) throw documentError("EMPTY_VIEWPORT", "Cannot verify rendering using a zero-size canvas. Resize the host viewport before capture.");
  await runtime.renderOnce();
  options.signal?.throwIfAborted();
  const dataUrl = canvas.toDataURL(options.mimeType || "image/png");
  if (!dataUrl.startsWith("data:image/")) throw documentError("CAPTURE_FAILED", "Canvas did not return an image.");
  return { kind: "scene", diagnosticRelighting: false, timestamp: new Date().toISOString(), revision: options.revision ?? null,
    views: [{ name: "active-camera", width: canvas.width, height: canvas.height, dataUrl }],
    observation: observeSceneRuntime(runtime) };
}

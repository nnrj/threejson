import { documentError } from "../document/sceneDocument.js";
import { Box3, Vector3, Frustum, Matrix4, Raycaster } from "three";
import { inspectGeometryQuality } from "../geometry/geometryQuality.js";

/** Inspect render inputs, not a guessed verdict based on average pixel brightness. */
export function observeSceneRuntime(runtime, options = {}) {
  if (!runtime?.scene) return { available: false, render: "unchecked", resources: "unchecked" };
  const lights = [], visibleMeshes = [];
  runtime.scene.traverse((object) => {
    let visible = object.visible, parent = object.parent;
    while (parent && visible) { visible = parent.visible; parent = parent.parent; }
    if (object.isLight) lights.push({ type: object.type, intensity: object.intensity, visible, color: object.color?.getHexString?.() });
    if (visible && (object.isMesh || object.isPoints || object.isLine) && !object.userData?.editorOnly) visibleMeshes.push(object);
  });
  const diagnostics = runtime.runtimeContext?.resourceDiagnostics || runtime.runtimeContext?.diagnostics?.snapshot?.() || [];
  const objects = [], warnings = [], seenGeometry = new Map();
  runtime.scene.updateMatrixWorld(true); runtime.camera?.updateMatrixWorld(true);
  const frustum = runtime.camera ? new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(runtime.camera.projectionMatrix, runtime.camera.matrixWorldInverse)) : null;
  const cameraPosition = runtime.camera?.getWorldPosition(new Vector3()), ray = new Raycaster();
  for (const object of visibleMeshes.slice(0, options.maxObjects || 200)) {
    const id = object.userData?.objJson?.threeJsonId || object.userData?.threeJsonId || object.name || object.uuid;
    const bounds = new Box3().setFromObject(object), center = bounds.getCenter(new Vector3());
    const inFrustum = !bounds.isEmpty() && frustum ? frustum.intersectsBox(bounds) : null;
    let projectedBounds = null, centerOccluded = null;
    if (inFrustum && runtime.camera) {
      const projected = [];
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) projected.push(new Vector3(x, y, z).project(runtime.camera));
      const min = [Math.min(...projected.map(p => p.x)), Math.min(...projected.map(p => p.y))], max = [Math.max(...projected.map(p => p.x)), Math.max(...projected.map(p => p.y))];
      projectedBounds = { min, max, viewportFraction: Math.max(0, Math.min(1, max[0]) - Math.max(-1, min[0])) * Math.max(0, Math.min(1, max[1]) - Math.max(-1, min[1])) / 4, approximate: true };
      if (options.occlusion === true && objects.length < 32 && object.isMesh) {
        ray.set(cameraPosition, center.clone().sub(cameraPosition).normalize()); ray.far = cameraPosition.distanceTo(center);
        const hit = ray.intersectObjects(visibleMeshes.filter(o => o.isMesh), false)[0];
        centerOccluded = Boolean(hit && hit.object !== object); // One ray is evidence, not full visibility proof.
      }
    }
    let geometry;
    if (object.isMesh && object.geometry) {
      if (!seenGeometry.has(object.geometry)) seenGeometry.set(object.geometry, inspectGeometryQuality(object.geometry, { maxTriangles: options.maxTriangles || 10000, maxVertices: options.maxVertices || 30000 }));
      geometry = seenGeometry.get(object.geometry);
      if (geometry.invalidPositions || geometry.invalidIndices || geometry.invalidNormals) warnings.push({ code: "INVALID_GEOMETRY", severity: "error", id, message: "Geometry contains invalid positions, indices or normals." });
      if (geometry.reversedNormals || geometry.inconsistentWindingEdges) warnings.push({ code: "GEOMETRY_ORIENTATION", severity: "warning", id, message: "Inspect face winding/normal disagreement; intentional inside surfaces are permitted." });
    }
    if (!runtime.scene.environment && [].concat(object.material || []).some(m => m.metalness > .7 && !m.envMap)) warnings.push({ code: "METAL_WITHOUT_ENVIRONMENT", severity: "warning", id, message: "Metal has no reflection environment; check authored illumination." });
    objects.push({ id, type: object.type, inFrustum, projectedBounds, centerOccluded, geometry });
  }
  if (objects.length && objects.every(o => o.inFrustum === false)) warnings.push({ code: "ALL_SUBJECTS_OUT_OF_FRAME", severity: "error", message: "All inspected renderable objects lie outside the authored camera frustum." });
  return { available: true, previewPerformance: runtime.renderLoop?.previewPerformance?.mode || "full", lights, visibleObjectCount: visibleMeshes.length, objects, geometryCoverage: visibleMeshes.length <= objects.length ? "complete-object-list" : "sampled-object-list",
    environment: Boolean(runtime.scene.environment), background: runtime.scene.background?.isColor ? `#${runtime.scene.background.getHexString()}` : runtime.scene.background ? "texture" : null,
    toneMapping: runtime.renderer?.toneMapping, exposure: runtime.renderer?.toneMappingExposure,
    camera: runtime.camera ? { type: runtime.camera.type, position: runtime.camera.position.toArray(), quaternion: runtime.camera.quaternion.toArray(), near: runtime.camera.near, far: runtime.camera.far, zoom: runtime.camera.zoom } : null,
    resources: { status: diagnostics.some((item) => /FAILED|ERROR|TIMEOUT/.test(item.code || "") || item.status === "failed") ? "degraded" : "no-reported-failures", diagnostics },
    warnings: [
      ...warnings,
      ...diagnostics.filter(item => /FAILED|ERROR|TIMEOUT/.test(item.code || "") || item.status === "failed").map(item => ({ code: item.code || "RESOURCE_FAILED", severity: "error", message: item.message || item.url || "A required resource failed.", resource: item })),
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
  // Paused/demand runtimes intentionally make renderOnce a no-op. Inspection
  // must draw evaluated state without starting RAF or advancing animation clocks.
  if (runtime.renderLoop?.renderCurrentFrame) await runtime.renderLoop.renderCurrentFrame();
  else await runtime.renderOnce();
  options.signal?.throwIfAborted();
  const dataUrl = canvas.toDataURL(options.mimeType || "image/png");
  if (!dataUrl.startsWith("data:image/")) throw documentError("CAPTURE_FAILED", "Canvas did not return an image.");
  return { kind: "scene", diagnosticRelighting: false, timestamp: new Date().toISOString(), revision: options.revision ?? null,
    views: [{ name: "active-camera", width: canvas.width, height: canvas.height, dataUrl }],
    observation: observeSceneRuntime(runtime) };
}

/** Small ROI readback, not a whole-screen brightness score. Deliberately only
 * reports measurements: darkness can be an authored night scene or silhouette. */
export function measureSubjectRegions(canvas, observation) {
  if (!canvas || typeof globalThis.document?.createElement !== "function") return [];
  const scratch = globalThis.document.createElement("canvas"); scratch.width = 160; scratch.height = 90;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(canvas, 0, 0, 160, 90);
  const pixels = ctx.getImageData(0, 0, 160, 90).data;
  return (observation.objects || []).filter(o => o.inFrustum && o.projectedBounds).sort((a,b) => b.projectedBounds.viewportFraction - a.projectedBounds.viewportFraction).slice(0, 8).map(object => {
    const { min, max } = object.projectedBounds;
    const x0 = Math.max(0, Math.min(159, Math.floor((min[0] + 1) * 80))), x1 = Math.max(x0 + 1, Math.min(160, Math.ceil((max[0] + 1) * 80)));
    const y0 = Math.max(0, Math.min(89, Math.floor((1 - max[1]) * 45))), y1 = Math.max(y0 + 1, Math.min(90, Math.ceil((1 - min[1]) * 45)));
    const luminance = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * 160 + x) * 4; luminance.push((.2126*pixels[i] + .7152*pixels[i+1] + .0722*pixels[i+2])/255); }
    luminance.sort((a,b) => a-b);
    return { id: object.id, approximate: true, displayLuminance: { p10: luminance[Math.floor((luminance.length-1)*.1)], median: luminance[Math.floor((luminance.length-1)*.5)], p90: luminance[Math.floor((luminance.length-1)*.9)] }, samplePixels: luminance.length };
  });
}

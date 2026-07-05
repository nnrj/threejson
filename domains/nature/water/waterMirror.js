/**
 * Ultra water: plane reflection RT (same idea as Three.js examples Water.js).
 */
import * as THREE from "three";

/**
 * @param {import("three").Mesh} mesh
 * @param {object} [options]
 * @returns {object|null}
 */
export function attachWaterMirror(mesh, options = {}) {
  if (!mesh?.isMesh || !mesh.material?.uniforms?.mirrorSampler) {
    return null;
  }
  const resolution = Math.min(
    2048,
    Math.max(128, Math.floor(Number(options.mirrorResolution) || 512))
  );
  const clipBias = Number.isFinite(Number(options.clipBias)) ? Number(options.clipBias) : 0;

  const renderTarget = new THREE.WebGLRenderTarget(resolution, resolution, {
    type: THREE.HalfFloatType
  });
  const textureMatrix = new THREE.Matrix4();
  const mirrorCamera = new THREE.PerspectiveCamera();
  const mirrorPlane = new THREE.Plane();
  const normal = new THREE.Vector3();
  const mirrorWorldPosition = new THREE.Vector3();
  const cameraWorldPosition = new THREE.Vector3();
  const rotationMatrix = new THREE.Matrix4();
  const lookAtPosition = new THREE.Vector3(0, 0, -1);
  const clipPlane = new THREE.Vector4();
  const view = new THREE.Vector3();
  const target = new THREE.Vector3();
  const q = new THREE.Vector4();

  mesh.material.uniforms.mirrorSampler.value = renderTarget.texture;
  mesh.material.uniforms.textureMatrix.value = textureMatrix;
  mesh.material.uniforms.hasMirror.value = 1;

  const previousOnBeforeRender = mesh.onBeforeRender;

  mesh.onBeforeRender = function onWaterMirrorBeforeRender(renderer, scene, camera) {
    previousOnBeforeRender?.call(this, renderer, scene, camera);

    mirrorWorldPosition.setFromMatrixPosition(mesh.matrixWorld);
    cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
    rotationMatrix.extractRotation(mesh.matrixWorld);

    normal.set(0, 1, 0);
    normal.applyMatrix4(rotationMatrix);

    view.subVectors(mirrorWorldPosition, cameraWorldPosition);
    if (view.dot(normal) > 0) {
      return;
    }

    view.reflect(normal).negate();
    view.add(mirrorWorldPosition);

    rotationMatrix.extractRotation(camera.matrixWorld);
    lookAtPosition.set(0, 0, -1);
    lookAtPosition.applyMatrix4(rotationMatrix);
    lookAtPosition.add(cameraWorldPosition);

    target.subVectors(mirrorWorldPosition, lookAtPosition);
    target.reflect(normal).negate();
    target.add(mirrorWorldPosition);

    mirrorCamera.position.copy(view);
    mirrorCamera.up.set(0, 1, 0);
    mirrorCamera.up.applyMatrix4(rotationMatrix);
    mirrorCamera.up.reflect(normal);
    mirrorCamera.lookAt(target);
    mirrorCamera.far = camera.far;
    mirrorCamera.updateMatrixWorld();
    mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);

    textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0);
    textureMatrix.multiply(mirrorCamera.projectionMatrix);
    textureMatrix.multiply(mirrorCamera.matrixWorldInverse);

    mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorWorldPosition);
    mirrorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse);
    clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);

    const projectionMatrix = mirrorCamera.projectionMatrix;
    q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
    q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
    q.z = -1.0;
    q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
    projectionMatrix.elements[2] = clipPlane.x;
    projectionMatrix.elements[6] = clipPlane.y;
    projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
    projectionMatrix.elements[14] = clipPlane.w;

    if (mesh.material.uniforms.eye) {
      mesh.material.uniforms.eye.value.setFromMatrixPosition(camera.matrixWorld);
    }

    const currentRenderTarget = renderer.getRenderTarget();
    const currentXrEnabled = renderer.xr.enabled;
    const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const wasVisible = mesh.visible;

    mesh.visible = false;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(renderTarget);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) {
      renderer.clear();
    }
    renderer.render(scene, mirrorCamera);
    mesh.visible = wasVisible;
    renderer.xr.enabled = currentXrEnabled;
    renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
    renderer.setRenderTarget(currentRenderTarget);

    const viewport = camera.viewport;
    if (viewport !== undefined) {
      renderer.state.viewport(viewport);
    }
  };

  const ctx = {
    renderTarget,
    dispose() {
      if (mesh.onBeforeRender === onWaterMirrorBeforeRender) {
        mesh.onBeforeRender = previousOnBeforeRender;
      }
      if (mesh.material?.uniforms?.hasMirror) {
        mesh.material.uniforms.hasMirror.value = 0;
      }
      renderTarget.dispose();
    }
  };
  mesh.userData.waterMirror = ctx;
  return ctx;
}

/**
 * @param {import("three").Mesh|null|undefined} mesh
 */
export function disposeWaterMirror(mesh) {
  mesh?.userData?.waterMirror?.dispose?.();
  if (mesh?.userData) {
    delete mesh.userData.waterMirror;
  }
}

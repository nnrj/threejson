import * as THREE from "three";
import { buildAdaptiveContentBoundingBoxTHREE } from "threejson";

function setRect(rect, x, y, width, height) {
  rect.x = Math.max(0, Math.floor(x));
  rect.y = Math.max(0, Math.floor(y));
  rect.width = Math.max(0, Math.floor(width));
  rect.height = Math.max(0, Math.floor(height));
}

function applyDebugRect(dom, rect) {
  if (!dom) {
    return;
  }
  dom.style.left = `${rect.x}px`;
  dom.style.top = `${rect.y}px`;
  dom.style.width = `${Math.max(0, rect.width)}px`;
  dom.style.height = `${Math.max(0, rect.height)}px`;
}

/** Editor orthographic three-view mode (main + top/front/side). */
export function createEditorThreeView(host) {
  const canvasWrap = document.getElementById("canvasWrap");
  const canvasContainer = document.getElementById("canvasContainer");
  const threeViewDebugLayer = document.getElementById("threeViewDebugLayer");
  const debugMainView = document.getElementById("debugMainView");
  const debugTopView = document.getElementById("debugTopView");
  const debugFrontView = document.getElementById("debugFrontView");
  const debugSideView = document.getElementById("debugSideView");
  const menuToggleThreeView = document.getElementById("menuToggleThreeView");

  let threeViewEnabled = false;
  let threeViewRenderFailCount = 0;
  let threeViewFallbackWarned = false;
  let topCamera = null;
  let frontCamera = null;
  let sideCamera = null;

  const mainViewRect = { x: 0, y: 0, width: 0, height: 0 };
  const topViewRect = { x: 0, y: 0, width: 0, height: 0 };
  const frontViewRect = { x: 0, y: 0, width: 0, height: 0 };
  const sideViewRect = { x: 0, y: 0, width: 0, height: 0 };

  function isEnabled() {
    return threeViewEnabled;
  }

  function syncMenuLabel() {
    if (menuToggleThreeView) {
      menuToggleThreeView.textContent = threeViewEnabled ? "切换普通视图" : "切换三视图";
    }
  }

  function updateThreeViewDebugOverlay() {
    if (!threeViewDebugLayer) {
      return;
    }
    threeViewDebugLayer.style.display = threeViewEnabled ? "block" : "none";
    if (!threeViewEnabled) {
      return;
    }
    applyDebugRect(debugMainView, mainViewRect);
    applyDebugRect(debugTopView, topViewRect);
    applyDebugRect(debugFrontView, frontViewRect);
    applyDebugRect(debugSideView, sideViewRect);
  }

  function updateViewRects() {
    const sysConfig = host.getSysConfig();
    const width = canvasWrap?.clientWidth || sysConfig.canvasWidth;
    const height = canvasWrap?.clientHeight || sysConfig.canvasHeight;
    if (!threeViewEnabled) {
      setRect(mainViewRect, 0, 0, width, height);
      setRect(topViewRect, 0, 0, 0, 0);
      setRect(frontViewRect, 0, 0, 0, 0);
      setRect(sideViewRect, 0, 0, 0, 0);
      updateThreeViewDebugOverlay();
      return;
    }
    const gap = 2;
    const sideColWidth = Math.max(220, Math.floor(width * 0.28));
    const mainWidth = Math.max(120, width - sideColWidth - gap);
    const sideWidth = Math.max(80, width - mainWidth - gap);
    const itemHeight = Math.max(60, Math.floor((height - gap * 2) / 3));
    const lastHeight = Math.max(60, height - itemHeight * 2 - gap * 2);
    setRect(mainViewRect, 0, 0, mainWidth, height);
    setRect(topViewRect, mainWidth + gap, 0, sideWidth, itemHeight);
    setRect(frontViewRect, mainWidth + gap, itemHeight + gap, sideWidth, itemHeight);
    setRect(sideViewRect, mainWidth + gap, itemHeight * 2 + gap * 2, sideWidth, lastHeight);
    updateThreeViewDebugOverlay();
  }

  function initThreeViewCameras() {
    if (!topCamera) {
      topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
    }
    if (!frontCamera) {
      frontCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
    }
    if (!sideCamera) {
      sideCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
    }
  }

  function cameraCanSeeSphere(viewCamera, center, radius) {
    if (!viewCamera || !Number.isFinite(radius) || radius <= 0) {
      return false;
    }
    const frustum = new THREE.Frustum();
    const matrix = new THREE.Matrix4().multiplyMatrices(
      viewCamera.projectionMatrix,
      viewCamera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(matrix);
    return frustum.intersectsSphere(new THREE.Sphere(center, radius));
  }

  function updateThreeViewCameras() {
    const scene = host.getScene();
    const camera = host.getCamera();
    const controls = host.getControls();
    if (!threeViewEnabled || !scene) {
      return true;
    }
    initThreeViewCameras();
    updateViewRects();
    const center = controls?.target?.clone?.() || new THREE.Vector3(0, 10, 0);
    const distanceFromMain = camera?.position?.distanceTo?.(center) || 70;
    const bounds = buildAdaptiveContentBoundingBoxTHREE(scene, { ignoreHelper: null });
    const size = new THREE.Vector3();
    let maxSize = 0;
    if (bounds && !bounds.isEmpty()) {
      bounds.getCenter(center);
      bounds.getSize(size);
      maxSize = Math.max(size.x || 0, size.y || 0, size.z || 0);
    }
    if (!Number.isFinite(maxSize) || maxSize <= 1) {
      maxSize = Math.max(distanceFromMain * 1.2, 32);
    }
    const baseDistance = Math.max(distanceFromMain * 1.35, maxSize * 1.25, 65);
    const baseHalfSpan = Math.max(maxSize * 0.64, 25);
    const sphereRadius = Math.max(maxSize * 0.58, 13);

    function fitOrtho(cam, viewRect, spanScale) {
      const aspect = viewRect.height > 0 ? viewRect.width / viewRect.height : 1;
      const halfSpan = baseHalfSpan * spanScale;
      cam.left = -halfSpan * aspect;
      cam.right = halfSpan * aspect;
      cam.top = halfSpan;
      cam.bottom = -halfSpan;
      cam.near = 0.1;
      cam.far = Math.max(baseDistance * 10, 800);
      cam.updateProjectionMatrix();
    }

    function placeCameras(distanceScale, spanScale) {
      fitOrtho(topCamera, topViewRect, spanScale);
      fitOrtho(frontCamera, frontViewRect, spanScale * 1.06);
      fitOrtho(sideCamera, sideViewRect, spanScale * 1.06);
      const distance = baseDistance * distanceScale;
      topCamera.position.set(center.x, center.y + distance, center.z);
      topCamera.up.set(0, 0, -1);
      topCamera.lookAt(center);
      topCamera.updateMatrixWorld(true);
      frontCamera.position.set(center.x, center.y, center.z + distance);
      frontCamera.up.set(0, 1, 0);
      frontCamera.lookAt(center);
      frontCamera.updateMatrixWorld(true);
      sideCamera.position.set(center.x + distance, center.y, center.z);
      sideCamera.up.set(0, 1, 0);
      sideCamera.lookAt(center);
      sideCamera.updateMatrixWorld(true);
    }

    const attemptFactors = [
      { distanceScale: 1, spanScale: 1 },
      { distanceScale: 1.35, spanScale: 1.55 },
      { distanceScale: 1.8, spanScale: 2.1 }
    ];
    for (const factor of attemptFactors) {
      placeCameras(factor.distanceScale, factor.spanScale);
      if (
        cameraCanSeeSphere(topCamera, center, sphereRadius) &&
        cameraCanSeeSphere(frontCamera, center, sphereRadius) &&
        cameraCanSeeSphere(sideCamera, center, sphereRadius)
      ) {
        return true;
      }
    }
    return false;
  }

  function renderViewport(renderer, viewRect, viewCamera, scene, canvasHeight, options = {}) {
    if (!viewCamera || viewRect.width <= 0 || viewRect.height <= 0) {
      return;
    }
    const transformHelper = options.transformHelper;
    let helperWasVisible = true;
    if (transformHelper && options.hideTransformHelper) {
      helperWasVisible = transformHelper.visible !== false;
      transformHelper.visible = false;
    }
    const glY = canvasHeight - viewRect.y - viewRect.height;
    renderer.setViewport(viewRect.x, glY, viewRect.width, viewRect.height);
    renderer.setScissor(viewRect.x, glY, viewRect.width, viewRect.height);
    renderer.clearDepth();
    renderer.render(scene, viewCamera);
    if (transformHelper && options.hideTransformHelper) {
      transformHelper.visible = helperWasVisible;
    }
  }

  function afterRender() {
    if (!threeViewEnabled) {
      return;
    }
    const renderer = host.getRenderer();
    const scene = host.getScene();
    const camera = host.getCamera();
    const sysConfig = host.getSysConfig();
    if (!renderer || !scene || !camera) {
      return;
    }
    const healthy = updateThreeViewCameras();
    const mainAspect =
      mainViewRect.height > 0 ? mainViewRect.width / mainViewRect.height : camera.aspect;
    if (Number.isFinite(mainAspect) && Math.abs(camera.aspect - mainAspect) > 1e-4) {
      camera.aspect = mainAspect;
      camera.updateProjectionMatrix();
    }
    const transformHelper = host.getEditorInteraction()?.getTransformControlsHelper?.() ?? null;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.clear(true, true, true);
    renderViewport(renderer, mainViewRect, camera, scene, sysConfig.canvasHeight, {
      transformHelper
    });
    renderViewport(renderer, topViewRect, topCamera, scene, sysConfig.canvasHeight, {
      transformHelper,
      hideTransformHelper: true
    });
    renderViewport(renderer, frontViewRect, frontCamera, scene, sysConfig.canvasHeight, {
      transformHelper,
      hideTransformHelper: true
    });
    renderViewport(renderer, sideViewRect, sideCamera, scene, sysConfig.canvasHeight, {
      transformHelper,
      hideTransformHelper: true
    });
    renderer.setScissorTest(false);
    renderer.autoClear = prevAutoClear;

    if (healthy) {
      threeViewRenderFailCount = 0;
      threeViewFallbackWarned = false;
      return;
    }
    threeViewRenderFailCount += 1;
    const settings = host.getEditorSettings();
    const warnAfter = settings?.threeView?.warnAfterFailCount ?? 24;
    const fallbackAfter = settings?.threeView?.fallbackAfterFailCount ?? 120;
    if (!threeViewFallbackWarned && threeViewRenderFailCount > warnAfter) {
      threeViewFallbackWarned = true;
      host.showMessage("三视图辅视口取景异常，正在尝试自动修复...", "warning");
    }
    if (threeViewRenderFailCount > fallbackAfter) {
      host.showMessage("三视图辅视口仍异常，已自动切回普通视图。", "warning");
      switchToNormalView(true);
    }
  }

  function switchToNormalView(byFallback = false) {
    const sysConfig = host.getSysConfig();
    sysConfig.viewType = "1";
    threeViewEnabled = false;
    host.getRenderLoop()?.setComposer?.(host.getEditorInteraction()?.getComposer?.() ?? null);
    updateViewRects();
    syncMenuLabel();
    host.windowResize?.();
    host.getEditorChromeUi?.()?.applyStatusBarHintFromSettings?.(host.getEditorSettings?.());
    if (!byFallback) {
      host.showMessage("已切换回普通视图。", "info");
    }
  }

  function switchView() {
    const sysConfig = host.getSysConfig();
    if (sysConfig.viewType !== "2") {
      if (!host.getScene()?.isScene) {
        host.showMessage("请先加载场景。", "warning");
        return;
      }
      sysConfig.viewType = "2";
      threeViewEnabled = true;
      threeViewRenderFailCount = 0;
      threeViewFallbackWarned = false;
      updateViewRects();
      updateThreeViewCameras();
      host.getRenderLoop()?.setComposer?.(null);
      syncMenuLabel();
      host.windowResize?.();
      host.showMessage("已切换三视图：主视口可编辑，右侧三视口为只读观察。", "success");
      return;
    }
    switchToNormalView(false);
  }

  function isPointInMainViewport(clientX, clientY) {
    if (!threeViewEnabled || !canvasContainer) {
      return true;
    }
    const canvasRect = canvasContainer.getBoundingClientRect();
    const localX = clientX - canvasRect.left;
    const localY = clientY - canvasRect.top;
    return (
      localX >= mainViewRect.x &&
      localX <= mainViewRect.x + mainViewRect.width &&
      localY >= mainViewRect.y &&
      localY <= mainViewRect.y + mainViewRect.height
    );
  }

  /** Map canvas client coords to main-viewport-normalized pick space. */
  function canvasPickMetrics(clientX, clientY) {
    if (!canvasContainer) {
      return null;
    }
    const rect = canvasContainer.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (threeViewEnabled) {
      return {
        inMain: isPointInMainViewport(clientX, clientY),
        localX: localX - mainViewRect.x,
        localY: localY - mainViewRect.y,
        width: mainViewRect.width,
        height: mainViewRect.height
      };
    }
    return {
      inMain: true,
      localX,
      localY,
      width: rect.width,
      height: rect.height
    };
  }

  function onWindowResize() {
    updateViewRects();
    if (threeViewEnabled) {
      updateThreeViewCameras();
    }
  }

  function dispose() {
    switchToNormalView(true);
  }

  syncMenuLabel();

  function getFitViewAspectHints() {
    return {
      rendererDomElement: host.getRenderer()?.domElement,
      threeViewActive: threeViewEnabled,
      mainViewRect,
      canvasWrap
    };
  }

  return {
    isEnabled,
    switchView,
    afterRender,
    onWindowResize,
    isPointInMainViewport,
    canvasPickMetrics,
    dispose,
    getMainViewRect: () => ({ ...mainViewRect }),
    updateViewRects,
    updateThreeViewCameras,
    getFitViewAspectHints
  };
}

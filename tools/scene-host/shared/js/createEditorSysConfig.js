/** Default editor sysConfig — aligned with scene-editor.html baseline. */
export function createEditorSysConfig() {
  return {
    canvasWidth: 0,
    canvasHeight: 0,
    gridShow: false,
    axesShow: false,
    autoResize: true,
    renderMode: undefined,
    sceneLocked: false,
    dragLocked: false,
    rightClickedFlag: false,
    impactCheckFlag: false,
    sceneAutoRotate: false,
    antialias: true,
    ratioRate: 1,
    fps: 60,
    lowFps: false,
    progressFlag: true,
    optimizeJson: true,
    windowSizeNow: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    firstAutoResize: true,
    meshObjects: [],
    meshList: [],
    jsonData: {},
    viewType: "1",
    initFlags: {
      boxInitFlag: false,
      groupInitFlag: false,
      domainModelInitFlag: false,
      infoPanelInitFlag: false,
      lineInitFlag: false,
      heatMapInitFlag: false,
      highLightInitFlag: false,
      sphereInitFlag: false
    },
    clickHighLightFlag: false
  };
}

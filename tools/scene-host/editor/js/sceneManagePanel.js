import { isCanonicalScenePayload, sceneToStandardJsonSimple } from "threejson";
import { parseTextureQuality } from "../../../../core/util/textureSampling.js";
import { refreshDeployTextureContextFromPayload } from "./editorMeshVisualSync.js";

function el(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = el(id);
  if (node) {
    node.value = value == null ? "" : String(value);
  }
}

function setCheck(id, value) {
  const node = el(id);
  if (node) {
    node.checked = Boolean(value);
  }
}

function setNum(id, value, fallback = "") {
  const node = el(id);
  if (!node) {
    return;
  }
  const n = Number(value);
  node.value = Number.isFinite(n) ? String(n) : (fallback === "" ? "" : String(fallback));
}

function readNum(id, fallback) {
  const node = el(id);
  if (!node) {
    return fallback;
  }
  const n = Number(node.value);
  return Number.isFinite(n) ? n : fallback;
}

function formatVec3(obj) {
  if (!obj || typeof obj !== "object") {
    return "";
  }
  return `${obj.x ?? 0}, ${obj.y ?? 0}, ${obj.z ?? 0}`;
}

function parseVec3(text, fallback = { x: 0, y: 0, z: 0 }) {
  const parts = String(text || "")
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 3) {
    return { ...fallback };
  }
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  const c = Number(parts[2]);
  return {
    x: Number.isFinite(a) ? a : fallback.x,
    y: Number.isFinite(b) ? b : fallback.y,
    z: Number.isFinite(c) ? c : fallback.z
  };
}

function deployTextureConfigSnapshot(sceneConfig) {
  const sc = sceneConfig && typeof sceneConfig === "object" ? sceneConfig : {};
  return {
    textureQuality: parseTextureQuality(sc.textureQuality),
    textureDefaults: sc.textureDefaults ?? null
  };
}

function deployTextureConfigChanged(before, after) {
  return before.textureQuality !== after.textureQuality
    || JSON.stringify(before.textureDefaults) !== JSON.stringify(after.textureDefaults);
}

function ensureNested(obj, key) {
  if (!obj[key] || typeof obj[key] !== "object" || Array.isArray(obj[key])) {
    obj[key] = {};
  }
  return obj[key];
}

export function createSceneManagePanel(host) {
  const panel = document.getElementById("rightSubPanelSceneJson");
  const applyBtn = document.getElementById("sceneManageApplyToCanvasBtn");
  let syncing = false;
  let payloadViewStale = false;

  function markPayloadViewStale() {
    payloadViewStale = true;
  }

  function markPayloadViewFresh() {
    payloadViewStale = false;
  }

  async function refreshFromSceneIfStale() {
    if (!payloadViewStale) {
      return;
    }
    payloadViewStale = false;
    await host.ensureCanvasSyncedBeforeExport?.();
    const scene = host.getScene();
    if (!scene?.isScene) {
      bindFromPayload();
      return;
    }
    const payload = sceneToStandardJsonSimple(scene, {
      ...host.buildSceneToJsonOptions?.({ merge: false, format: "standard" }),
      merge: false,
      format: "standard"
    });
    const sysConfig = host.getSysConfig();
    if (sysConfig) {
      sysConfig.jsonData = payload;
    }
    bindFromPayload(payload);
    host.getRightSidebarCache?.()?.markSceneJsonViewFresh?.();
  }

  function bindFromPayload(payload = host.getSysConfig()?.jsonData) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    syncing = true;
    try {
      setText("sceneManageThreeJsonId", payload.threeJsonId || "");
      setText("sceneManageName", payload.name || "");
      setText("sceneManageLabel", payload.label || "");
      setText("sceneManageRemark", payload.remark || "");
      setText("sceneManageVersion", payload.version || "");
      if (isCanonicalScenePayload(payload)) {
        return;
      }
      const sc = payload.sceneConfig && typeof payload.sceneConfig === "object" ? payload.sceneConfig : {};
      const rd = sc.runtimeDefaults && typeof sc.runtimeDefaults === "object" ? sc.runtimeDefaults : {};
      const cam = sc.camera && typeof sc.camera === "object" ? sc.camera : {};
      const ren = sc.renderer && typeof sc.renderer === "object" ? sc.renderer : {};
      const ctrl = sc.controls && typeof sc.controls === "object" ? sc.controls : {};
      const loop = sc.renderLoop && typeof sc.renderLoop === "object" ? sc.renderLoop : {};
      const sched = sc.deployScheduler && typeof sc.deployScheduler === "object" ? sc.deployScheduler : {};

      setCheck("sceneManageEnableDefaultModel", sc.enableDefaultModel);
      setCheck("sceneManageEnableComposeBoxModel", sc.enableComposeBoxModel);
      setCheck("sceneManageAutoFillCamera", rd.autoFillCamera);
      setCheck("sceneManageAutoFitCamera", rd.autoFitCamera);
      setText("sceneManageAutoFitCameraMode", rd.autoFitCameraMode || "positionAndTarget");

      setNum("sceneManageCameraFov", cam.fov, 50);
      setNum("sceneManageCameraNear", cam.near, 0.15);
      setNum("sceneManageCameraFar", cam.far, 3500);
      setText("sceneManageCameraPos", formatVec3(cam.position));

      setCheck("sceneManageRendererAntialias", ren.antialias !== false);
      setCheck("sceneManageRendererShadow", ren.shadowMapEnabled !== false);
      setCheck("sceneManageRendererAlpha", ren.alpha !== false);
      setNum("sceneManageRendererClearAlpha", ren.clearAlpha, 0.1);
      setNum("sceneManageRendererRatioRate", ren.ratioRate, 1);
      const tqEl = el("sceneManageTextureQuality");
      if (tqEl) {
        const tier = parseTextureQuality(sc.textureQuality);
        tqEl.value = tier === null ? "" : String(tier);
      }

      setCheck("sceneManageCtrlDamping", ctrl.enableDamping !== false);
      setNum("sceneManageCtrlDampingFactor", ctrl.dampingFactor, 0.35);
      setCheck("sceneManageCtrlZoom", ctrl.enableZoom !== false);
      setCheck("sceneManageCtrlPan", ctrl.enablePan !== false);
      setCheck("sceneManageCtrlAutoRotate", ctrl.autoRotate);
      setNum("sceneManageCtrlMinDist", ctrl.minDistance, 5);
      setNum("sceneManageCtrlMaxDist", ctrl.maxDistance, 2600);
      setNum("sceneManageCtrlMaxPolar", ctrl.maxPolarAngle, Math.PI / 1.9);
      setText("sceneManageCtrlTarget", formatVec3(ctrl.target));

      setNum("sceneManageLoopFps", loop.fps, 60);
      setCheck("sceneManageLoopLowFps", loop.lowFps);
      setCheck("sceneManageLoopAutoResize", loop.autoResize !== false);
      setCheck("sceneManageLoopFirstAutoResize", loop.firstAutoResize !== false);

      setCheck("sceneManageSchedEnabled", sched.enabled);
      setText("sceneManageSchedMode", sched.mode || "scheduled");
      setText("sceneManageSchedPolicy", sched.policy || "timeslot");
      setNum("sceneManageSchedFluxMs", sched.fluxMs, 10);
      setNum("sceneManageSchedDensity", sched.density, 10);
      setNum("sceneManageSchedMaxInFlight", sched.maxInFlightAsync, 4);

      const helpers = sc.helpers && typeof sc.helpers === "object" ? sc.helpers : {};
      const gridHelper = helpers.grid && typeof helpers.grid === "object" ? helpers.grid : {};
      const axesHelper = helpers.axes && typeof helpers.axes === "object" ? helpers.axes : {};
      setCheck("sceneManageGridShow", gridHelper.visible);
      setCheck("sceneManageAxesShow", axesHelper.visible);

      const interaction =
        sc.interaction && typeof sc.interaction === "object" ? sc.interaction : {};
      const bindEl = el("sceneManageBindSceneEvents");
      if (bindEl) {
        if (interaction.bindSceneEvents === true) {
          bindEl.value = "true";
        } else if (interaction.bindSceneEvents === false) {
          bindEl.value = "false";
        } else {
          bindEl.value = "";
        }
      }
    } finally {
      syncing = false;
    }
  }

  function applyToPayload(options = {}) {
    const { silent = false } = options;
    const payload = host.getSysConfig()?.jsonData;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      host.showMessage("当前无场景数据。", "warning");
      return false;
    }
    const name = String(el("sceneManageName")?.value ?? "").trim();
    const label = String(el("sceneManageLabel")?.value ?? "").trim();
    const remark = String(el("sceneManageRemark")?.value ?? "").trim();
    if (name) {
      payload.name = name;
    }
    if (label) {
      payload.label = label;
      host.updateSceneTitle?.(label);
    } else {
      delete payload.label;
    }
    if (remark) {
      payload.remark = remark;
    } else {
      delete payload.remark;
    }

    if (!isCanonicalScenePayload(payload)) {
      const scBefore = payload.sceneConfig && typeof payload.sceneConfig === "object" ? payload.sceneConfig : {};
      const prevDeployTexture = deployTextureConfigSnapshot(scBefore);
      const sc = ensureNested(payload, "sceneConfig");
      sc.enableDefaultModel = el("sceneManageEnableDefaultModel")?.checked === true;
      sc.enableComposeBoxModel = el("sceneManageEnableComposeBoxModel")?.checked === true;
      const rd = ensureNested(sc, "runtimeDefaults");
      rd.autoFillCamera = el("sceneManageAutoFillCamera")?.checked === true;
      rd.autoFitCamera = el("sceneManageAutoFitCamera")?.checked === true;
      const fitMode = String(el("sceneManageAutoFitCameraMode")?.value || "").trim();
      if (fitMode) {
        rd.autoFitCameraMode = fitMode;
      }

      const cam = ensureNested(sc, "camera");
      cam.fov = readNum("sceneManageCameraFov", cam.fov ?? 50);
      cam.near = readNum("sceneManageCameraNear", cam.near ?? 0.15);
      cam.far = readNum("sceneManageCameraFar", cam.far ?? 3500);
      cam.position = parseVec3(el("sceneManageCameraPos")?.value, cam.position);

      const ren = ensureNested(sc, "renderer");
      ren.antialias = el("sceneManageRendererAntialias")?.checked === true;
      ren.shadowMapEnabled = el("sceneManageRendererShadow")?.checked === true;
      ren.alpha = el("sceneManageRendererAlpha")?.checked === true;
      ren.clearAlpha = readNum("sceneManageRendererClearAlpha", ren.clearAlpha ?? 0.1);
      ren.ratioRate = readNum("sceneManageRendererRatioRate", ren.ratioRate ?? 1);
      const tqRaw = String(el("sceneManageTextureQuality")?.value ?? "").trim();
      const tier = parseTextureQuality(tqRaw || null);
      if (tier === null) {
        delete sc.textureQuality;
      } else {
        sc.textureQuality = tier;
      }

      const ctrl = ensureNested(sc, "controls");
      ctrl.enableDamping = el("sceneManageCtrlDamping")?.checked === true;
      ctrl.dampingFactor = readNum("sceneManageCtrlDampingFactor", ctrl.dampingFactor ?? 0.35);
      ctrl.enableZoom = el("sceneManageCtrlZoom")?.checked === true;
      ctrl.enablePan = el("sceneManageCtrlPan")?.checked === true;
      ctrl.autoRotate = el("sceneManageCtrlAutoRotate")?.checked === true;
      ctrl.minDistance = readNum("sceneManageCtrlMinDist", ctrl.minDistance ?? 5);
      ctrl.maxDistance = readNum("sceneManageCtrlMaxDist", ctrl.maxDistance ?? 2600);
      ctrl.maxPolarAngle = readNum("sceneManageCtrlMaxPolar", ctrl.maxPolarAngle ?? Math.PI / 1.9);
      ctrl.target = parseVec3(el("sceneManageCtrlTarget")?.value, ctrl.target);

      const loop = ensureNested(sc, "renderLoop");
      loop.fps = readNum("sceneManageLoopFps", loop.fps ?? 60);
      loop.lowFps = el("sceneManageLoopLowFps")?.checked === true;
      loop.autoResize = el("sceneManageLoopAutoResize")?.checked === true;
      loop.firstAutoResize = el("sceneManageLoopFirstAutoResize")?.checked === true;

      const sched = ensureNested(sc, "deployScheduler");
      sched.enabled = el("sceneManageSchedEnabled")?.checked === true;
      sched.mode = String(el("sceneManageSchedMode")?.value || sched.mode || "scheduled");
      sched.policy = String(el("sceneManageSchedPolicy")?.value || sched.policy || "timeslot");
      sched.fluxMs = readNum("sceneManageSchedFluxMs", sched.fluxMs ?? 10);
      sched.density = readNum("sceneManageSchedDensity", sched.density ?? 10);
      sched.maxInFlightAsync = readNum("sceneManageSchedMaxInFlight", sched.maxInFlightAsync ?? 4);

      const helpers = ensureNested(sc, "helpers");
      const gridHelper = ensureNested(helpers, "grid");
      const axesHelper = ensureNested(helpers, "axes");
      gridHelper.visible = el("sceneManageGridShow")?.checked === true;
      axesHelper.visible = el("sceneManageAxesShow")?.checked === true;

      const bindRaw = String(el("sceneManageBindSceneEvents")?.value ?? "").trim();
      const interaction = ensureNested(sc, "interaction");
      if (bindRaw === "true") {
        interaction.bindSceneEvents = true;
      } else if (bindRaw === "false") {
        interaction.bindSceneEvents = false;
      } else {
        delete interaction.bindSceneEvents;
        if (!Object.keys(interaction).length) {
          delete sc.interaction;
        }
      }

      if (deployTextureConfigChanged(prevDeployTexture, deployTextureConfigSnapshot(sc))) {
        refreshDeployTextureContextFromPayload(host.getScene(), payload);
        host.getSceneTree()?.syncPropInputs?.(host.getSelectedObject());
      }
    }

    host.markSceneDirty?.();
    if (!silent) {
      host.showMessage("场景属性已写入 JSON。", "success");
    }
    return true;
  }

  async function applyToCanvas() {
    const aiOk = await host.getAiSidebar?.()?.interruptAiSessionIfActive?.("从 JSON 载入场景");
    if (!aiOk) {
      return;
    }
    const dirtyOk = await host.confirmOverwriteIfDirty?.({ actionLabel: "从 JSON 载入场景" });
    if (!dirtyOk) {
      return;
    }
    if (!applyToPayload({ silent: true })) {
      return;
    }
    await host.ensureCanvasSyncedBeforeExport?.();
    const payload = host.getSysConfig()?.jsonData;
    if (!payload) {
      return;
    }
    host.getScenePayloadFormat?.()?.recordEditorScenePayloadViewFormat?.(payload, "场景管理");
    const loaded = await host.ingestScenePayload(payload, "应用到画布");
    if (loaded) {
      host.getSceneManagePanel()?.bindFromPayload?.();
      host.showMessage("已应用到画布。", "success");
    }
  }

  applyBtn?.addEventListener("click", () => {
    void (async () => {
      try {
        await host.runWithLoadingMask?.("正在应用到画布...", () => applyToCanvas());
      } catch (error) {
        host.showMessage(String(error.message || error), "error");
        console.warn(error);
      }
    })();
  });

  if (panel) {
    const readOnlyIds = new Set(["sceneManageThreeJsonId", "sceneManageVersion"]);
    panel.querySelectorAll("input:not([readonly]), textarea, select").forEach((input) => {
      if (input.id && readOnlyIds.has(input.id)) {
        return;
      }
      if (input.type === "checkbox" || input.tagName === "SELECT") {
        input.addEventListener("change", () => {
          if (syncing) {
            return;
          }
          applyToPayload({ silent: true });
        });
      } else {
        input.addEventListener("blur", () => {
          if (syncing) {
            return;
          }
          applyToPayload({ silent: true });
        });
      }
    });
  }

  return {
    bindFromPayload,
    applyToPayload,
    applyToCanvas,
    markPayloadViewStale,
    markPayloadViewFresh,
    refreshFromSceneIfStale
  };
}

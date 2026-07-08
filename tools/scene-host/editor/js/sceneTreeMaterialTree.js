import { listMaterialSlotsForDescriptor } from "../../../../core/util/materialDescriptorWalk.js";
import { getByPointer, setByPointer } from "../../../../core/util/jsonPointer.js";
import { applyTextureRepeatToMap } from "../../../../core/util/loadTextureFromMaterialJson.js";
import {
  clampTextureRepeatComponent,
  isDefaultTextureRepeat,
  shouldRedeployForDescriptorMaterial,
  toHexColorString
} from "./sceneTreeMaterialHelpers.js";
import { syncEditorMeshVisualFromObjJson } from "./editorMeshVisualSync.js";
import { createTextureSamplingAdvancedModal } from "./sceneTreeTextureSamplingModal.js";
import {
  buildTextureQualitySelectOptions,
  formatEffectiveSummaryForMaterial,
  materialHasExplicitSamplingOverrides,
  readTextureQualityFromMaterial,
  writeTextureQualityToMaterial
} from "./sceneTreeTextureSamplingHelpers.js";
import { t } from "../../shared/i18n/index.js";

function applyTextureRepeatFromSlotPointer(mesh, rootData, pointer) {
  if (!mesh?.isMesh) {
    return;
  }
  const slotMat = getByPointer(rootData, pointer);
  if (!slotMat || typeof slotMat !== "object") {
    return;
  }
  const matIndexMatch = String(pointer).match(/^materials\.(\d+)$/);
  if (matIndexMatch) {
    const idx = Number(matIndexMatch[1]);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats[idx]?.map) {
      applyTextureRepeatToMap(mats[idx].map, slotMat);
      mats[idx].needsUpdate = true;
    }
    return;
  }
  syncEditorMeshVisualFromObjJson(mesh, rootData);
}

function ensureSceneAssetLibraryArray(host) {
  const data = host.getSysConfig()?.jsonData;
  if (!data || typeof data !== "object") {
    return [];
  }
  if (Array.isArray(data.assetLibrary)) {
    return data.assetLibrary;
  }
  data.worldInfo = data.worldInfo || {};
  if (!Array.isArray(data.worldInfo.assetLibrary)) {
    data.worldInfo.assetLibrary = [];
  }
  return data.worldInfo.assetLibrary;
}

function isTextureAssetKind(kind) {
  return String(kind ?? "texture").trim().toLowerCase() === "texture";
}

function buildAssetLibSelectOptions(host, selectedId) {
  const lib = ensureSceneAssetLibraryArray(host);
  const opts = [`<option value="">${t("editor.material.directUrl", "(Direct URL)")}</option>`];
  lib.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const id = String(entry.threeJsonId ?? entry.id ?? "").trim();
    if (!id || !isTextureAssetKind(entry.assetKind)) {
      return;
    }
    const label = entry.name ? `${id} (${entry.name})` : id;
    const val = `${LIB_PREFIX}${id}`;
    const sel = val === selectedId ? " selected" : "";
    opts.push(`<option value="${val.replace(/"/g, "&quot;")}"${sel}>${label}</option>`);
  });
  return opts.join("");
}

function ensureMaterialObjectAtPointer(root, pointer) {
  let mat = getByPointer(root, pointer);
  if (!mat || typeof mat !== "object" || Array.isArray(mat)) {
    setByPointer(root, pointer, { type: "standard" }, { createMissing: true });
    mat = getByPointer(root, pointer);
  }
  return mat;
}

export function createSceneTreeMaterialTree(host, { isPropSyncing }) {
  const rootEl = document.getElementById("sceneTreeMaterialTreeRoot");
  const legacyBlock = document.getElementById("sceneTreePropLegacyMaterial");
  const samplingModal = createTextureSamplingAdvancedModal(host);

  let redeployTimer = null;

  function isBlurRedeployEnabled() {
    return host.getEditorSettings()?.editing?.blurRedeployOnPropertyChange !== false;
  }

  function getBlurRedeployDebounceMs() {
    const n = Number(host.getEditorSettings()?.editing?.blurRedeployDebounceMs);
    return Number.isFinite(n) && n >= 0 ? n : 400;
  }

  function schedulePropertyRedeployDebounced() {
    if (redeployTimer) {
      window.clearTimeout(redeployTimer);
    }
    redeployTimer = window.setTimeout(() => {
      redeployTimer = null;
      const selectedObj = host.getSelectedObject();
      if (!selectedObj || isPropSyncing()) {
        return;
      }
      const threeJsonId = String(selectedObj.userData?.objJson?.threeJsonId || "").trim();
      if (!threeJsonId) {
        return;
      }
      host.getSceneTree()?.applyPropertyRedeployAfterEdit?.({ silent: true });
    }, getBlurRedeployDebounceMs());
  }

  function captureHistorySnapshot(threeJsonId, object3D) {
    return host.getSceneTree()?.captureObjectHistorySnapshot?.(threeJsonId, object3D) ?? null;
  }

  function commitMaterialSlotField(pointer, field, value, options = {}) {
    const { recordHistory = true, redeploy = true } = options;
    const selectedObj = host.getSelectedObject();
    const data = selectedObj?.userData?.objJson;
    if (!data) {
      return;
    }
    const threeJsonId = String(data.threeJsonId || "").trim();
    const beforeObjJson =
      recordHistory && threeJsonId ? captureHistorySnapshot(threeJsonId, selectedObj) : null;
    ensureMaterialObjectAtPointer(data, pointer);
    if (field === "textureQuality") {
      const slotMat = getByPointer(data, pointer);
      if (slotMat && typeof slotMat === "object") {
        writeTextureQualityToMaterial(
          slotMat,
          value === undefined || value === null ? "" : String(value)
        );
      }
    } else if (field === "textureRepeat" && isDefaultTextureRepeat(value)) {
      const slotMat = getByPointer(data, pointer);
      if (slotMat && typeof slotMat === "object") {
        delete slotMat.textureRepeat;
      }
    } else {
      const matPtr = `${pointer}/${field}`;
      setByPointer(data, matPtr, value, { createMissing: true });
    }
    host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
    if (field === "textureRepeat" && selectedObj?.isMesh) {
      applyTextureRepeatFromSlotPointer(selectedObj, data, pointer);
    }
    if (
      (field === "textureQuality" || field.startsWith("textureSampling"))
      && selectedObj?.isMesh
    ) {
      syncEditorMeshVisualFromObjJson(selectedObj, data);
    }
    if (recordHistory && threeJsonId && beforeObjJson) {
      const afterObjJson = captureHistorySnapshot(threeJsonId, selectedObj);
      if (afterObjJson && JSON.stringify(beforeObjJson) !== JSON.stringify(afterObjJson)) {
        host.getEditorHistory()?.pushObjectObjJsonSnapshot(
          threeJsonId,
          beforeObjJson,
          afterObjJson,
          "材质树属性"
        );
      }
    }
    if (redeploy && isBlurRedeployEnabled()) {
      schedulePropertyRedeployDebounced();
    }
  }

  function render(model) {
    if (!rootEl) {
      return;
    }
    const data = model?.userData?.objJson;
    const slots = data ? listMaterialSlotsForDescriptor(data) : [];
    if (!slots.length) {
      rootEl.hidden = true;
      rootEl.innerHTML = "";
      if (legacyBlock) {
        legacyBlock.hidden = false;
      }
      return;
    }
    if (legacyBlock) {
      legacyBlock.hidden = true;
    }
    rootEl.hidden = false;
    rootEl.innerHTML = "";
    const openAll = slots.length <= 2;
    slots.forEach((slot) => {
      const mat = getByPointer(data, slot.pointer);
      if (!mat || typeof mat !== "object") {
        return;
      }
      const texUrl = typeof mat.textureUrl === "string" ? mat.textureUrl : "";
      const repeat = mat.textureRepeat && typeof mat.textureRepeat === "object" ? mat.textureRepeat : {};
      const repeatX = Number.isFinite(Number(repeat.x)) ? Number(repeat.x) : 1;
      const repeatY = Number.isFinite(Number(repeat.y)) ? Number(repeat.y) : 1;
      const color = toHexColorString(mat.color, "#ffffff");
      const libOpts = buildAssetLibSelectOptions(host, texUrl);
      const qualityVal = readTextureQualityFromMaterial(mat);
      const qualityOpts = buildTextureQualitySelectOptions(qualityVal);
      const customHint = materialHasExplicitSamplingOverrides(mat)
        ? ` ${t("editor.material.customizedSuffix", "(customized)")}`
        : "";
      const effectiveSummary = formatEffectiveSummaryForMaterial(mat, "imageMap");
      const details = document.createElement("details");
      details.className = "sceneTreeMatSlotDetails";
      details.open = openAll;
      details.dataset.pointer = slot.pointer;
      const summary = document.createElement("summary");
      summary.textContent = slot.label;
      details.appendChild(summary);
      const grid = document.createElement("div");
      grid.className = "sceneTreeMaterialSlotGrid";
      grid.innerHTML = `<label>${t("editor.material.texture", "Texture")}</label>
        <input type="text" class="sceneTreeMatTex" value="${texUrl.replace(/"/g, "&quot;")}" spellcheck="false">
        <label>lib</label>
        <select class="sceneTreeMatLib">${libOpts}</select>
        <label>${t("editor.material.repeatX", "Repeat X")}</label>
        <input type="number" class="sceneTreeMatRepeatX" step="0.1" min="0.01" value="${repeatX}">
        <label>${t("editor.material.repeatY", "Repeat Y")}</label>
        <input type="number" class="sceneTreeMatRepeatY" step="0.1" min="0.01" value="${repeatY}">
        <label>${t("editor.material.color", "Color")}</label>
        <input type="color" class="sceneTreeMatColor" value="${color}">
        <label>${t("editor.material.textureSampling", "Texture Sampling")}</label>
        <div class="sceneTreeMatSamplingRow">
          <select class="sceneTreeMatQuality">${qualityOpts}</select>
          <button type="button" class="sceneTreeMatSamplingAdvancedLink">${t("editor.material.advancedSettings", "Advanced Settings")}${customHint}</button>
        </div>
        <span class="sceneTreeMatSamplingEffective" colspan="2">${t("editor.material.effective", "Effective")}: ${effectiveSummary || "—"}</span>`;
      details.appendChild(grid);
      const texInput = grid.querySelector(".sceneTreeMatTex");
      const libSelect = grid.querySelector(".sceneTreeMatLib");
      const repeatXInput = grid.querySelector(".sceneTreeMatRepeatX");
      const repeatYInput = grid.querySelector(".sceneTreeMatRepeatY");
      const colorInput = grid.querySelector(".sceneTreeMatColor");
      const qualitySelect = grid.querySelector(".sceneTreeMatQuality");
      const advancedBtn = grid.querySelector(".sceneTreeMatSamplingAdvancedLink");
      const effectiveEl = grid.querySelector(".sceneTreeMatSamplingEffective");
      libSelect?.addEventListener("change", () => {
        if (isPropSyncing()) {
          return;
        }
        const v = libSelect.value;
        if (v && texInput) {
          texInput.value = v;
        }
        commitMaterialSlotField(slot.pointer, "textureUrl", texInput?.value ?? "", { recordHistory: true });
      });
      texInput?.addEventListener("blur", () => {
        if (isPropSyncing()) {
          return;
        }
        commitMaterialSlotField(slot.pointer, "textureUrl", texInput.value, { recordHistory: true });
      });
      const commitRepeatFromInputs = () => {
        if (isPropSyncing()) {
          return;
        }
        commitMaterialSlotField(
          slot.pointer,
          "textureRepeat",
          {
            x: clampTextureRepeatComponent(repeatXInput?.value, 1),
            y: clampTextureRepeatComponent(repeatYInput?.value, 1)
          },
          { recordHistory: true, redeploy: false }
        );
      };
      repeatXInput?.addEventListener("blur", commitRepeatFromInputs);
      repeatYInput?.addEventListener("blur", commitRepeatFromInputs);
      colorInput?.addEventListener("change", () => {
        if (isPropSyncing()) {
          return;
        }
        commitMaterialSlotField(slot.pointer, "color", toHexColorString(colorInput.value, "#ffffff"), {
          recordHistory: true
        });
      });
      qualitySelect?.addEventListener("change", () => {
        if (isPropSyncing()) {
          return;
        }
        commitMaterialSlotField(slot.pointer, "textureQuality", qualitySelect.value, {
          recordHistory: true,
          redeploy: false
        });
      });
      advancedBtn?.addEventListener("click", () => {
        if (isPropSyncing()) {
          return;
        }
        samplingModal.openModal({
          pointer: slot.pointer,
          profileName: "imageMap",
          slotLabel: slot.label,
          rootData: data,
          mesh: host.getSelectedObject(),
          onCommitted: () => render(host.getSelectedObject())
        });
      });
      rootEl.appendChild(details);
    });
  }

  return { render, commitMaterialSlotField };
}

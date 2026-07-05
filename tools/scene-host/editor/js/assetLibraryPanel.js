export function createAssetLibraryPanel(host) {
  const listEl = document.getElementById("assetLibraryList");
  const form = {
    id: document.getElementById("assetLibraryFormId"),
    name: document.getElementById("assetLibraryFormName"),
    kind: document.getElementById("assetLibraryFormKind"),
    url: document.getElementById("assetLibraryFormUrl"),
    extra: document.getElementById("assetLibraryFormExtra")
  };
  const addBtn = document.getElementById("assetLibraryAddBtn");
  const deleteBtn = document.getElementById("assetLibraryDeleteBtn");
  const saveBtn = document.getElementById("assetLibrarySaveBtn");

  let selectedIndex = -1;

  function ensureLibraryArray() {
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

  function isTextureKind(kind) {
    return String(kind ?? "texture").trim().toLowerCase() === "texture";
  }

  function fillForm(entry) {
    if (!entry || typeof entry !== "object") {
      return;
    }
    if (form.id) form.id.value = String(entry.threeJsonId ?? entry.id ?? "");
    if (form.name) form.name.value = String(entry.name ?? "");
    if (form.kind) form.kind.value = String(entry.assetKind ?? "texture");
    if (form.url) form.url.value = String(entry.url ?? entry.textureUrl ?? entry.src ?? "");
    if (form.extra) {
      const extra = { ...entry };
      delete extra.threeJsonId;
      delete extra.id;
      delete extra.name;
      delete extra.assetKind;
      delete extra.url;
      delete extra.textureUrl;
      delete extra.src;
      const keys = Object.keys(extra);
      form.extra.value = keys.length ? JSON.stringify(extra, null, 2) : "";
    }
  }

  function buildEntryFromForm() {
    const id = String(form.id?.value ?? "").trim();
    if (!id) {
      throw new Error("threeJsonId 不能为空");
    }
    const kind = String(form.kind?.value ?? "texture").trim() || "texture";
    const entry = { threeJsonId: id, assetKind: kind };
    const name = String(form.name?.value ?? "").trim();
    if (name) {
      entry.name = name;
    }
    const url = String(form.url?.value ?? "").trim();
    if (url) {
      entry.url = url;
    }
    const extraRaw = String(form.extra?.value ?? "").trim();
    if (extraRaw) {
      const extra = JSON.parse(extraRaw);
      if (extra && typeof extra === "object" && !Array.isArray(extra)) {
        Object.assign(entry, extra);
      }
    }
    return entry;
  }

  function render() {
    if (!listEl) {
      return;
    }
    const lib = ensureLibraryArray();
    listEl.innerHTML = "";
    lib.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const id = String(entry.threeJsonId ?? entry.id ?? "").trim() || "(无 id)";
      const kind = String(entry.assetKind ?? "texture").trim();
      const url = String(entry.url ?? entry.textureUrl ?? entry.src ?? "").trim();
      const row = document.createElement("div");
      row.className = "assetLibraryRow";
      row.setAttribute("role", "option");
      row.dataset.index = String(index);
      if (index === selectedIndex) {
        row.classList.add("assetLibraryRowSelected");
      }
      const runtimeBadge = isTextureKind(kind)
        ? ""
        : '<span class="assetLibraryBadgeRuntime">未接入运行时</span>';
      row.innerHTML = `<div class="assetLibraryRowMain"><div class="assetLibraryRowId">${id}</div><div class="assetLibraryRowMeta">${kind}${url ? " · " + url : ""}</div></div>${runtimeBadge}`;
      row.addEventListener("click", () => {
        selectedIndex = index;
        fillForm(entry);
        render();
      });
      listEl.appendChild(row);
    });
  }

  function saveFromForm() {
    try {
      const entry = buildEntryFromForm();
      const lib = ensureLibraryArray();
      const id = entry.threeJsonId;
      const idx = lib.findIndex((e) => String(e?.threeJsonId ?? e?.id ?? "").trim() === id);
      if (idx >= 0) {
        lib[idx] = entry;
        selectedIndex = idx;
      } else {
        lib.push(entry);
        selectedIndex = lib.length - 1;
      }
      host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
      host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
      render();
      fillForm(entry);
      host.showMessage("已保存资源库条目。", "success");
    } catch (error) {
      host.showMessage(`保存资源库条目失败：${error?.message || error}`, "error");
    }
  }

  function deleteSelected() {
    const lib = ensureLibraryArray();
    if (selectedIndex < 0 || selectedIndex >= lib.length) {
      host.showMessage("请先选择要删除的条目。", "warning");
      return;
    }
    lib.splice(selectedIndex, 1);
    selectedIndex = -1;
    if (form.id) form.id.value = "";
    if (form.name) form.name.value = "";
    if (form.url) form.url.value = "";
    if (form.extra) form.extra.value = "";
    host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
    render();
    host.showMessage("已删除资源库条目。", "success");
  }

  addBtn?.addEventListener("click", () => {
    selectedIndex = -1;
    if (form.id) form.id.value = `asset-${Date.now()}`;
    if (form.name) form.name.value = "";
    if (form.kind) form.kind.value = "texture";
    if (form.url) form.url.value = "";
    if (form.extra) form.extra.value = "";
    render();
  });
  saveBtn?.addEventListener("click", () => saveFromForm());
  deleteBtn?.addEventListener("click", () => deleteSelected());

  return {
    render,
    clear() {
      selectedIndex = -1;
      if (listEl) listEl.innerHTML = "";
    }
  };
}

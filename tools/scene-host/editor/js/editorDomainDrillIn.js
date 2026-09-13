import {
  DOMAIN_EDIT_STATES,
  applyDomainChildEditResolution,
  domainChildTransformsChanged,
  getDomainEditState,
  resolveDomainDeployRoot,
  resolveDomainEditSettings,
  snapshotDomainChildTransforms
} from "../lib/domainEditSession.js";
import { setDomainEditState } from "../../../../core/handler/domainDeployDescriptor.js";
import { indexSceneDocument, cloneDocumentData } from "threejson/document";

function formatDomainEditStateLabel(state) {
  const map = {
    [DOMAIN_EDIT_STATES.PRISTINE]: "pristine",
    [DOMAIN_EDIT_STATES.SHELL_DIRTY]: "shellDirty",
    [DOMAIN_EDIT_STATES.CHILDREN_DIRTY]: "childrenDirty",
    [DOMAIN_EDIT_STATES.PENDING_RESOLUTION]: "待确认",
    [DOMAIN_EDIT_STATES.BOUND]: "bound",
    [DOMAIN_EDIT_STATES.DEGRADED]: "已退化"
  };
  return map[state] || String(state || "-");
}

export function createEditorDomainDrillIn(host) {
  let drillInRoot = null;
  let childEditBaseline = null;
  let documentBaseline = null;
  let resolutionTarget = null;

  const modal = document.getElementById("domainEditResolutionModal");
  const bodyEl = document.getElementById("domainEditResolutionBody");

  function shouldSkipObject(obj) {
    return host.getSceneTree()?.isRuntimeOnlyObject?.(obj) ?? false;
  }

  function clearDrillInSession() {
    drillInRoot = null;
    childEditBaseline = null;
    documentBaseline = null;
  }

  function enterDrillIn(root) {
    if (!root) {
      return;
    }
    drillInRoot = root;
    childEditBaseline = snapshotDomainChildTransforms(root, { state: "authoring", includeDescriptor: true });
    documentBaseline = null;
    const session = host.getAuthoringSession?.()?.session;
    if (session) {
      const index = indexSceneDocument(session.document);
      for (let object = root; object; object = object.parent) {
        const id = object.userData?.objJson?.threeJsonId, entry = index.get(id);
        if (entry) { documentBaseline = { id, descriptor: cloneDocumentData(entry.record) }; break; }
      }
    }
    host.setEventNotice?.("Domain 子编辑：可编辑子对象；右键退出并确认处理方式。");
  }

  function tryEnterOnRootDoubleClick(root) {
    if (!root || drillInRoot === root) {
      return false;
    }
    const selected = host.getSelectedObject();
    const editActive = host.getEditorInteraction()?.isObjectEditActive?.() ?? false;
    if (selected === root && editActive) {
      enterDrillIn(root);
      return true;
    }
    return false;
  }

  function closeResolutionModal() {
    if (modal) {
      modal.hidden = true;
      modal.classList.remove("visible");
    }
    resolutionTarget = null;
  }

  function openResolutionModal(root) {
    resolutionTarget = root;
    if (bodyEl) {
      const name = root?.name || root?.userData?.objJson?.name || "未命名";
      bodyEl.textContent = `域对象「${name}」已有部件修改。可保留工厂参数和部件修改；不兼容的结构变更需要显式转换为普通 group。`;
    }
    if (modal) {
      modal.hidden = false;
      modal.classList.add("visible");
    }
  }

  function readBindingFromUi(root) {
    return {
      domain:
        document.getElementById("sceneTreePropDomainId")?.value ||
        root?.userData?.objJson?.domain,
      handler:
        document.getElementById("sceneTreePropDomainHandler")?.value ||
        root?.userData?.objJson?.handler
    };
  }

  async function applyResolution(action, root) {
    const authoring = host.getAuthoringSession?.();
    try {
      if (action === "undo" && authoring?.session && documentBaseline) {
        // Rebuild the complete record, including materials and topology.
        await authoring.replaceObject(documentBaseline.id, documentBaseline.descriptor, { label: "撤销 Domain 子编辑", discardPreview: true });
        return { ok: true };
      }
      const result = applyDomainChildEditResolution(action, root, {
        captureState: "authoring", childBaseline: childEditBaseline,
        binding: readBindingFromUi(root), exportOptions: { shouldSkipObject, state: "authoring" }
      });
      if (result.ok && authoring?.session) await authoring.recordRuntimeEdit(action === "degrade" ? "转换 Domain 为 group" : "保留 Domain 部件修改");
      return result;
    } catch (error) { return { ok: false, error: error.message }; }
  }

  async function applySilentResolution(root) {
    const settings = resolveDomainEditSettings(host.getEditorSettings());
    const result = await applyResolution(settings.silentDefaultAction, root);
    if (result.error && result.degraded) {
      host.showMessage(`绑定失败，已退化为 group：${result.error}`, "warning");
    } else if (!result.ok && result.error) {
      host.showMessage(result.error, "warning");
      openResolutionModal(root);
      return;
    }
    setDomainEditState(root, getDomainEditState(root));
    host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
    const selected = host.getSelectedObject();
    host.getSceneTree()?.syncPropInputs(selected || root);
    host.getEditorInteraction()?.refreshMeshList?.();
    host.getSceneTree()?.render?.();
    if (host.getCodeEditor()?.isCodeEditMode?.()) {
      void host.getCodeEditor()?.refreshFromScene?.();
    }
  }

  function resolveOnExit() {
    if (!drillInRoot) {
      return;
    }
    const root = drillInRoot;
    const baseline = childEditBaseline;
    drillInRoot = null;
    const changed = domainChildTransformsChanged(baseline, snapshotDomainChildTransforms(root, { state: "authoring", includeDescriptor: true }));
    if (!changed) {
      childEditBaseline = null;
      documentBaseline = null;
      return;
    }
    setDomainEditState(root, DOMAIN_EDIT_STATES.PENDING_RESOLUTION);
    const settings = resolveDomainEditSettings(host.getEditorSettings());
    if (!settings.promptOnChildChange) {
      void applySilentResolution(root);
      return;
    }
    openResolutionModal(root);
  }

  async function commitResolution(action) {
    const root = resolutionTarget;
    if (!root) {
      closeResolutionModal();
      return;
    }
    const remember = Boolean(document.getElementById("domainEditRememberDefaultCb")?.checked);
    if (remember) {
      const settings = host.getEditorSettings();
      if (settings) {
        if (!settings.domainEdit) {
          settings.domainEdit = {};
        }
        settings.domainEdit.promptOnChildChange = false;
        settings.domainEdit.silentDefaultAction = action;
        host.persistSettings?.();
      }
    }
    const result = await applyResolution(action, root);
    if (result.error && result.degraded) {
      host.showMessage(`绑定失败，已退化为 group：${result.error}`, "warning");
    } else if (!result.ok && result.error) {
      host.showMessage(result.error, "error");
      return;
    }
    closeResolutionModal();
    childEditBaseline = null;
    documentBaseline = null;
    host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
    host.getEditorInteraction()?.refreshMeshList?.();
    const selected = host.getSelectedObject();
    host.getSceneTree()?.syncPropInputs(selected || root);
    host.getSceneTree()?.render?.();
    if (host.getCodeEditor()?.isCodeEditMode?.()) {
      void host.getCodeEditor()?.refreshFromScene?.();
    }
    host.showMessage(
      action === "degrade" ? "已转换为普通 group。" : action === "undo" ? "已撤销子对象编辑。" : "已保留 Domain 参数和部件修改。",
      "success"
    );
  }

  function syncEditStateAfterTransform(target) {
    const scene = host.getScene();
    if (!target || !scene) {
      return;
    }
    let root = resolveDomainDeployRoot(target, scene);
    // A nested factory (e.g. a door hinge) is still part of the active assembly
    // edit. Mark that assembly, not just the nearest nested factory.
    for (let parent = target; parent; parent = parent.parent) {
      if (parent === drillInRoot) { root = drillInRoot; break; }
    }
    if (!root) {
      return;
    }
    if (drillInRoot === root && target !== root) {
      setDomainEditState(root, DOMAIN_EDIT_STATES.CHILDREN_DIRTY);
    } else if (target === root) {
      // Moving the shell must not discard previously bound child modifications.
      if (getDomainEditState(root) !== DOMAIN_EDIT_STATES.BOUND) setDomainEditState(root, DOMAIN_EDIT_STATES.SHELL_DIRTY);
    }
  }

  function resolveDomainRootForObject(obj) {
    return resolveDomainDeployRoot(obj, host.getScene());
  }

  function init() {
    document.getElementById("domainEditResolveBindBtn")?.addEventListener("click", () => {
      commitResolution("bind");
    });
    document.getElementById("domainEditResolveDegradeBtn")?.addEventListener("click", () => {
      commitResolution("degrade");
    });
    document.getElementById("domainEditResolveUndoBtn")?.addEventListener("click", () => {
      commitResolution("undo");
    });
    modal?.addEventListener("click", (event) => {
      if (event.target?.id === "domainEditResolutionModal") {
        closeResolutionModal();
      }
    });
  }

  return {
    init,
    tryEnterOnRootDoubleClick,
    resolveOnExit,
    syncEditStateAfterTransform,
    resolveDomainRootForObject,
    formatDomainEditStateLabel,
    isDrillInActive: () => Boolean(drillInRoot),
    clearDrillInSession
  };
}

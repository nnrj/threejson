import { assertSceneExportable } from "../../../../core/handler/domainDeployDescriptor.js";
import { collectDomainExportCaveats } from "../lib/domainEditSession.js";

export function createEditorDomainExport(host) {
  function shouldSkipObject(obj) {
    return host.getSceneTree()?.isRuntimeOnlyObject?.(obj) ?? false;
  }

  function sceneHasBlockingDomainExport() {
    const scene = host.getScene();
    if (!scene?.isScene) {
      return false;
    }
    return !assertSceneExportable(scene, { shouldSkipObject }).ok;
  }

  function formatDomainExportCaveatMessage(caveats) {
    if (!Array.isArray(caveats) || !caveats.length) {
      return "";
    }
    const names = caveats.map((c) => c.name || "未命名").join("、");
    return `场景已保存。以下 domain 对象的子件改动可能未写入 JSON（重载后子件可能复位）：${names}。可退化为 group 或等待 childMutations overlay。`;
  }

  function warnIfAny(options = {}) {
    const scene = host.getScene();
    if (!scene?.isScene) {
      return;
    }
    const caveats = collectDomainExportCaveats(scene, { shouldSkipObject });
    const message = formatDomainExportCaveatMessage(caveats);
    if (!message) {
      return;
    }
    if (options.silent) {
      console.warn("[domain-export]", message);
      return;
    }
    host.showMessage(message, "warning");
  }

  return {
    warnIfAny,
    sceneHasBlockingDomainExport
  };
}

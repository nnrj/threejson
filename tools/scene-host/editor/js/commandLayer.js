import {
  addObjectFromDescriptorAsync,
  captureObjectSnapshot,
  getObjectByThreeJsonId,
  normalizeCommand,
  parseCommandScript,
  removeObjectById
} from "threejson";
import {
  createCommandContext,
  createCommandRegistry,
  executeCommand
} from "../../../../core/command/index.js";
import { registerEditorCommands } from "../lib/command/index.js";
import { resolveRemoveCaptureSubtree } from "./sceneTreeContextMenu.js";

export function createCommandLayer(host) {
  let registry = null;
  let api = null;

  function ensure() {
    if (registry && api) {
      return api;
    }
    registry = createCommandRegistry();
    api = createEditorCommandApi();
    registerEditorCommands(registry, api);
    return api;
  }

  function buildContext() {
    return createCommandContext({
      scene: host.getScene() ?? null,
      camera: host.getCamera() ?? null,
      renderer: host.getRenderer() ?? null,
      controls: host.getControls() ?? null,
      document: host.getSysConfig()?.jsonData ?? null,
      options: {}
    });
  }

  function markCommandSceneDirty() {
    host.getSceneReserialize?.()?.markSceneNeedsReserialize?.();
    host.getEditorInteraction()?.refreshMeshList?.();
  }

  function createEditorCommandApi() {
    return {
      getCommandContext() {
        return buildContext();
      },
      async ingest(payload, options = {}) {
        try {
          const label = options.label || "命令载入";
          const loaded = await host.ingestScenePayload(payload, label, options);
          return { ok: Boolean(loaded), error: loaded ? null : "ingest returned false" };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      },
      getSelection() {
        return host.getSceneTree()?.readThreeJsonId(host.getSelectedObject()) || null;
      },
      setSelection(id) {
        const normalized = id == null ? "" : String(id).trim();
        if (!normalized) {
          host.setSelectedObject(null);
          host.getSceneTree()?.syncPropInputs(null);
          host.getSceneTree()?.render();
          return { ok: true };
        }
        return host.getSceneTree()?.setSelectionByThreeJsonId(normalized) || {
          ok: false,
          error: `Object not found for threeJsonId "${normalized}".`
        };
      },
      async undo() {
        const had = host.getEditorHistory()?.hasUndo?.() ?? false;
        if (had) {
          await host.getEditorHistory()?.undo();
        }
        return { ok: had };
      },
      async redo() {
        const had = host.getEditorHistory()?.hasRedo?.() ?? false;
        if (had) {
          await host.getEditorHistory()?.redo();
        }
        return { ok: had };
      },
      fitView(target = "scene") {
        if (target === "selection") {
          const ok = host.fitViewToSelectionBounds({ silent: false });
          return { ok: Boolean(ok), target };
        }
        const ok = host.fitViewToScene({ silent: false });
        return { ok: Boolean(ok), target };
      },
      async runAgent(input, extraOptions = {}) {
        return host.getAiSidebar()?.runAgent(input, extraOptions);
      },
      async execCoreCommands(input, options = {}) {
        ensure();
        const ctx = buildContext();
        const commands = Array.isArray(input)
          ? input.map((item) => normalizeCommand(item))
          : typeof input === "string"
            ? parseCommandScript(input)
            : [normalizeCommand(input)];
        const results = [];
        let ok = true;
        for (const cmd of commands) {
          const op = cmd.op;
          let result;
          if (op === "object.add") {
            result = await handleObjectAdd(ctx, cmd, options);
          } else if (op === "object.remove") {
            result = await handleObjectRemove(cmd, options);
          } else if (op === "object.patch" || op === "material.patch") {
            const id = String(cmd.args?.id ?? "").trim();
            const beforeObj = getObjectByThreeJsonId(id);
            const beforeObjJson = host.getSceneTree()?.captureObjectHistorySnapshot?.(
              id,
              beforeObj
            );
            result = await executeCommand(ctx, cmd, { registry, skipRuntimeGuard: true });
            if (result.ok) {
              if (beforeObjJson) {
                const afterObj = getObjectByThreeJsonId(id);
                const afterObjJson = host.getSceneTree()?.captureObjectHistorySnapshot?.(id, afterObj);
                if (afterObjJson) {
                  host.getEditorHistory()?.pushObjectObjJsonSnapshot?.(
                    id,
                    beforeObjJson,
                    afterObjJson,
                    options.label || "命令编辑"
                  );
                }
              }
              markCommandSceneDirty();
              host.getSceneTree()?.render?.();
            }
          } else if (op === "scene.applyPatch") {
            const patchArgs = { ...(cmd.args || {}) };
            delete patchArgs.json;
            result = await executeCommand(ctx, { ...cmd, args: patchArgs }, {
              registry,
              skipRuntimeGuard: true
            });
            if (result.ok && result.data?.json) {
              const loaded = await host.ingestScenePayload(result.data.json, options.label || "scene.applyPatch");
              if (!loaded) {
                result = { ok: false, op, error: "scene.applyPatch: 载入画布失败" };
              } else {
                ctx.scene = host.getScene() ?? null;
                ctx.camera = host.getCamera() ?? null;
                ctx.renderer = host.getRenderer() ?? null;
                ctx.controls = host.getControls() ?? null;
                ctx.document = host.getSysConfig()?.jsonData ?? null;
                markCommandSceneDirty();
                host.getSceneTree()?.render?.();
              }
            }
          } else if (op === "scene.load") {
            const loaded = await host.ingestScenePayload(cmd.args?.json, options.label || "scene.load", cmd.args?.options || {});
            result = { ok: Boolean(loaded), op, mode: "runtime", error: loaded ? null : "scene.load failed" };
          } else {
            result = await executeCommand(ctx, cmd, { registry, skipRuntimeGuard: op === "object.get" });
          }
          results.push(result);
          if (!result.ok) {
            ok = false;
            break;
          }
          ctx.scene = host.getScene() ?? null;
          ctx.camera = host.getCamera() ?? null;
          ctx.renderer = host.getRenderer() ?? null;
          ctx.controls = host.getControls() ?? null;
          ctx.document = host.getSysConfig()?.jsonData ?? null;
        }
        host.getSceneTree()?.render();
        return { ok, results };
      }
    };
  }

  async function handleObjectAdd(ctx, cmd, options) {
    const descriptor = cmd.args?.descriptor;
    const parentId = cmd.args?.parent;
    const scene = host.getScene();
    if (!scene || !descriptor) {
      return { ok: false, op: cmd.op, error: "object.add requires scene and descriptor" };
    }
    try {
      const res = await addObjectFromDescriptorAsync(scene, descriptor, {
        parent: parentId || undefined
      });
      if (!res?.threeJsonId) {
        return { ok: false, op: cmd.op, error: res?.error || "object.add failed" };
      }
      const addedSnapshot = captureObjectSnapshot(res.threeJsonId) || descriptor;
      host.getEditorHistory()?.pushObjectAddEntry?.(
        res.threeJsonId,
        addedSnapshot,
        parentId || "",
        options.label || "添加物体"
      );
      markCommandSceneDirty();
      host.getSceneTree()?.render?.();
      return { ok: true, op: cmd.op, mode: "runtime", data: { threeJsonId: res.threeJsonId } };
    } catch (err) {
      return { ok: false, op: cmd.op, error: String(err?.message || err) };
    }
  }

  async function handleObjectRemove(cmd, options = {}) {
    const id = String(cmd.args?.id ?? "").trim();
    const scene = host.getScene();
    if (!scene || !id) {
      return { ok: false, op: cmd.op, error: "object.remove requires id" };
    }
    const target = getObjectByThreeJsonId(id);
    const captureSubtree = target ? resolveRemoveCaptureSubtree(target) : false;
    const removed = removeObjectById(scene, id, { captureSubtree });
    if (!removed.ok) {
      return { ok: false, op: cmd.op, error: removed.error || "object.remove failed" };
    }
    host.getEditorHistory()?.pushObjectRemoveEntry?.(removed, options?.label || "删除物体");
    if (host.getSceneTree()?.readThreeJsonId(host.getSelectedObject()) === id) {
      host.setSelectedObject(null);
      host.getSceneTree()?.syncPropInputs(null);
    }
    host.getSceneTree()?.render();
    markCommandSceneDirty();
    return { ok: true, op: cmd.op, mode: "runtime", data: { threeJsonId: id } };
  }

  return {
    ensure,
    getApi() {
      return api || ensure();
    },
    getRegistry() {
      ensure();
      return registry;
    },
    async runBatch(input, options) {
      return ensure().execCoreCommands(input, options);
    }
  };
}

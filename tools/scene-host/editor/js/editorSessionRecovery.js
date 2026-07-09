import { parseSceneJsonString } from "threejson";
import {
  EDITOR_SESSION_RECOVERY_KEY,
  EDITOR_SESSION_TAB_KEY_PREFIX,
  EDITOR_TAB_SESSION_STORAGE_KEY,
  editorSessionIdbDelete,
  editorSessionIdbGet,
  editorSessionIdbPut
} from "../../shared/js/editorSessionIdb.js";
import { fingerprintSessionJsonText } from "../../shared/js/userBaselineStore.js";
import { t } from "../../shared/i18n/index.js";
import {
  buildCaptureOptionsForContext,
  captureCurrentSessionJsonText,
  SceneExportBlockedError
} from "./editorSessionCapture.js";

function tabSessionStoreKey(tabSessionId) {
  return `${EDITOR_SESSION_TAB_KEY_PREFIX}${tabSessionId}`;
}

function getOrCreateTabSessionId() {
  try {
    let id = sessionStorage.getItem(EDITOR_TAB_SESSION_STORAGE_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem(EDITOR_TAB_SESSION_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return `tab-fallback-${Date.now()}`;
  }
}

function formatSessionAge(updatedAt) {
  const ms = Date.now() - Number(updatedAt || 0);
  if (ms < 60_000) {
    return t("editor.session.age.justNow", "刚刚");
  }
  if (ms < 3_600_000) {
    return t("editor.session.age.minutesAgo", "{count} 分钟前", {
      count: Math.round(ms / 60_000)
    });
  }
  return t("editor.session.age.hoursAgo", "{count} 小时前", {
    count: Math.round(ms / 3_600_000)
  });
}

function resolveBootRestoreKind(recovery) {
  if (!recovery || recovery.sessionDirty !== true) {
    return "default";
  }
  if (recovery.autoSnapshot?.json) {
    return "snapshot_only";
  }
  return "default";
}

export function createEditorSessionRecovery(host) {
  let tabSessionId = "";
  let tabSessionRecord = null;
  let lastSavedAt = null;
  let lastAutoSnapshotFingerprint = null;
  let autoSnapshotTimer = null;
  let sessionAutoSnapshotDebounceTimer = null;
  let suppressBeforeUnload = false;

  const modal = document.getElementById("editorBootRestoreModal");
  const messageEl = document.getElementById("editorBootRestoreMessage");
  const footerEl = document.getElementById("editorBootRestoreFooter");

  function buildEmptyTabSessionRecord() {
    return {
      version: 1,
      tabSessionId,
      sessionDirty: false,
      lastSavedAt: null,
      autoSnapshot: null
    };
  }

  function getTabSessionRecordMutable() {
    if (!tabSessionRecord) {
      tabSessionRecord = buildEmptyTabSessionRecord();
    }
    return tabSessionRecord;
  }

  async function captureSessionJsonText(captureOptions = {}) {
    return captureCurrentSessionJsonText(host, captureOptions);
  }

  async function persistTabSessionRecord(extra = {}) {
    const record = {
      ...getTabSessionRecordMutable(),
      ...extra,
      tabSessionId,
      sessionDirty: host.getEditorDocumentState?.()?.isDirty?.() ?? false,
      lastSavedAt
    };
    tabSessionRecord = record;
    await editorSessionIdbPut(tabSessionStoreKey(tabSessionId), record);
    return record;
  }

  async function flushRecoveryRecord({ dirty } = {}) {
    const record = await persistTabSessionRecord({
      sessionDirty: dirty ?? host.getEditorDocumentState?.()?.isDirty?.() ?? false
    });
    try {
      await editorSessionIdbPut(EDITOR_SESSION_RECOVERY_KEY, record);
    } catch (error) {
      console.warn("[scene-editor session] write recovery failed:", error);
    }
    return record;
  }

  async function clearSessionStore() {
    try {
      const tabId = getOrCreateTabSessionId();
      await editorSessionIdbDelete(EDITOR_SESSION_RECOVERY_KEY);
      await editorSessionIdbDelete(tabSessionStoreKey(tabId));
    } catch (error) {
      console.warn("[scene-editor session] clear failed:", error);
    }
  }

  async function readRecoveryRecord() {
    try {
      return await editorSessionIdbGet(EDITOR_SESSION_RECOVERY_KEY);
    } catch {
      return null;
    }
  }

  async function readTabSessionRecord(id) {
    try {
      return await editorSessionIdbGet(tabSessionStoreKey(id));
    } catch {
      return null;
    }
  }

  function getAutoSnapshotIntervalMs() {
    const n = Number(host.getEditorSettings()?.session?.autoSnapshotIntervalMs);
    return Number.isFinite(n) && n >= 30_000 ? n : 120_000;
  }

  async function runAutoSnapshotCheck() {
    if (!host.getScene()?.isScene || document.visibilityState !== "visible") {
      return;
    }
    if (host.getEditorDomainExport?.()?.sceneHasBlockingDomainExport?.()) {
      console.warn("[scene-editor session] auto snapshot skipped: pending domain edit");
      return;
    }
    const run = async () => {
      try {
        const json = await captureSessionJsonText(
          buildCaptureOptionsForContext(host, "fullReplace")
        );
        if (!json) {
          return;
        }
        const fp = await fingerprintSessionJsonText(json);
        if (fp === lastAutoSnapshotFingerprint) {
          if (host.getEditorDocumentState?.()?.isDirty?.()) {
            await flushRecoveryRecord({ dirty: true });
          }
          return;
        }
        lastAutoSnapshotFingerprint = fp;
        const snap = { json, updatedAt: Date.now(), fingerprint: fp };
        await persistTabSessionRecord({ autoSnapshot: snap });
        if (host.getEditorDocumentState?.()?.isDirty?.()) {
          await flushRecoveryRecord({ dirty: true });
        }
        host.getEditorDomainExport?.()?.warnIfAny?.({ silent: true });
      } catch (error) {
        if (error instanceof SceneExportBlockedError) {
          console.warn("[scene-editor session] auto snapshot skipped:", error.message);
          return;
        }
        console.warn("[scene-editor session] auto snapshot failed:", error);
      }
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => {
        void run();
      });
    } else {
      void run();
    }
  }

  function scheduleDebouncedAutoSnapshot() {
    if (sessionAutoSnapshotDebounceTimer) {
      window.clearTimeout(sessionAutoSnapshotDebounceTimer);
    }
    sessionAutoSnapshotDebounceTimer = window.setTimeout(() => {
      sessionAutoSnapshotDebounceTimer = null;
      void runAutoSnapshotCheck();
    }, 1200);
  }

  async function writeInitialAutoSnapshot(captureOptions = {}) {
    try {
      const json = await captureSessionJsonText(captureOptions);
      if (!json) {
        return;
      }
      const fp = await fingerprintSessionJsonText(json);
      lastAutoSnapshotFingerprint = fp;
      const snap = { json, updatedAt: Date.now(), fingerprint: fp };
      await persistTabSessionRecord({ autoSnapshot: snap });
      if (host.getEditorDocumentState?.()?.isDirty?.()) {
        await flushRecoveryRecord({ dirty: true });
      }
    } catch (error) {
      console.warn("[scene-editor session] initial snapshot failed:", error);
    }
  }

  function startAutoSnapshotTimer() {
    if (autoSnapshotTimer) {
      return;
    }
    autoSnapshotTimer = window.setInterval(() => {
      void runAutoSnapshotCheck();
    }, getAutoSnapshotIntervalMs());
  }

  function restartAutoSnapshotTimer() {
    if (autoSnapshotTimer) {
      window.clearInterval(autoSnapshotTimer);
      autoSnapshotTimer = null;
    }
    startAutoSnapshotTimer();
  }

  async function clearAutoSnapshotOnNewIngest() {
    lastAutoSnapshotFingerprint = null;
    await persistTabSessionRecord({ autoSnapshot: null });
  }

  async function clearAutoSnapshotOnClose() {
    lastAutoSnapshotFingerprint = null;
    await persistTabSessionRecord({ autoSnapshot: null });
    await flushRecoveryRecord({ dirty: false });
  }

  async function syncAutoSnapshotAfterSave(json) {
    const fp = await fingerprintSessionJsonText(json);
    lastAutoSnapshotFingerprint = fp;
    await persistTabSessionRecord({
      autoSnapshot: {
        json,
        updatedAt: Date.now(),
        fingerprint: fp
      }
    });
    await flushRecoveryRecord({ dirty: false });
  }

  function openBootRestoreModalAndWait(recovery, kind) {
    if (!footerEl) {
      return Promise.resolve("ignore");
    }
    footerEl.innerHTML = "";
    const choices = [];

    const ignoreBtn = document.createElement("button");
    ignoreBtn.type = "button";
    ignoreBtn.className = "miniBtn";
    ignoreBtn.textContent = t("editor.shell.editorBootRestoreIgnoreBtn", "忽略");
    footerEl.appendChild(ignoreBtn);
    choices.push({ btn: ignoreBtn, value: "ignore" });

    if (kind === "snapshot_only") {
      const snapAge = recovery?.autoSnapshot
        ? formatSessionAge(recovery.autoSnapshot.updatedAt)
        : "";
      if (messageEl) {
        messageEl.textContent = t(
          "editor.session.bootRestore.snapshotMessage",
          "检测到上次离开时有未保存的修改。\n是否从自动快照恢复？（{age}）",
          { age: snapAge }
        );
      }
      const snapBtn = document.createElement("button");
      snapBtn.type = "button";
      snapBtn.className = "miniBtn";
      snapBtn.textContent = t("editor.session.bootRestore.restoreFromSnapshot", "从快照恢复");
      footerEl.insertBefore(snapBtn, ignoreBtn);
      choices.unshift({ btn: snapBtn, value: "snapshot" });
    }

    modal?.classList.add("visible");
    return new Promise((resolve) => {
      const cleanup = () => {
        modal?.classList.remove("visible");
      };
      for (const one of choices) {
        one.btn.addEventListener(
          "click",
          () => {
            cleanup();
            resolve(one.value);
          },
          { once: true }
        );
      }
      modal?.addEventListener(
        "click",
        (event) => {
          if (event.target === modal) {
            cleanup();
            resolve("ignore");
          }
        },
        { once: true }
      );
    });
  }

  async function tryOpenLastSceneOnStartup() {
    if (!host.getEditorSettings()?.general?.openLastSceneOnStartup) {
      return false;
    }
    const firstId = host.getRecentScenes()?.getFirstSceneId?.();
    if (!firstId) {
      return false;
    }
    return host.getRecentScenes()?.openById?.(firstId) ?? false;
  }

  async function bootstrapFromRecovery() {
    tabSessionId = getOrCreateTabSessionId();
    tabSessionRecord = (await readTabSessionRecord(tabSessionId)) || buildEmptyTabSessionRecord();
    lastSavedAt = tabSessionRecord.lastSavedAt ?? null;
    lastAutoSnapshotFingerprint = tabSessionRecord.autoSnapshot?.fingerprint ?? null;

    const recovery = await readRecoveryRecord();
    const kind = resolveBootRestoreKind(recovery);
    if (kind !== "default" && host.getEditorSettings()?.session?.promptOnBootRestore === false) {
      if (!(await tryOpenLastSceneOnStartup())) {
        host.toggleStartupEmptyState?.(true);
      }
      return;
    }
    if (kind === "default") {
      if (!(await tryOpenLastSceneOnStartup())) {
        host.toggleStartupEmptyState?.(true);
      }
      return;
    }

    const choice = await openBootRestoreModalAndWait(recovery, kind);
    if (choice === "ignore") {
      await clearSessionStore();
      tabSessionRecord = buildEmptyTabSessionRecord();
      if (!(await tryOpenLastSceneOnStartup())) {
        host.toggleStartupEmptyState?.(true);
      }
      return;
    }

    const payloadText = recovery?.autoSnapshot?.json;
    if (!payloadText) {
      host.toggleStartupEmptyState?.(true);
      return;
    }
    try {
      const parsed = parseSceneJsonString(payloadText);
      const loaded = await host.ingestScenePayload(
        parsed,
        t("editor.session.bootRestore.snapshotLabel", "快照恢复"),
        { skipHistoryPush: true }
      );
      if (!loaded) {
        host.toggleStartupEmptyState?.(true);
        return;
      }
      host.markSceneDirty?.();
      await writeInitialAutoSnapshot(buildCaptureOptionsForContext(host, "fullReplace"));
    } catch (error) {
      console.error(error);
      host.showMessage(
        t("editor.session.bootRestore.restoreFailed", "恢复失败：{error}", {
          error: error?.message || error
        }),
        "error"
      );
      host.toggleStartupEmptyState?.(true);
    }
  }

  function onDirty() {
    scheduleDebouncedAutoSnapshot();
  }

  function onSaved() {
    lastSavedAt = Date.now();
    void flushRecoveryRecord({ dirty: false });
  }

  function bindLifecycle() {
    window.addEventListener("pagehide", (event) => {
      if (event?.persisted || suppressBeforeUnload) {
        return;
      }
      void flushRecoveryRecord({
        dirty: host.getEditorDocumentState?.()?.isDirty?.() ?? false
      });
    });
    window.addEventListener("beforeunload", (event) => {
      if (suppressBeforeUnload) {
        return;
      }
      void flushRecoveryRecord({
        dirty: host.getEditorDocumentState?.()?.isDirty?.() ?? false
      });
      if (
        host.getEditorDocumentState?.()?.isDirty?.() &&
        host.getEditorSettings()?.session?.beforeUnloadWarn !== false
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
      if (host.getEditorSettings()?.session?.clearCacheOnExit) {
        void host.getEditorCacheClear?.()?.clearByScope?.(
          host.getEditorSettings()?.session?.clearCacheOnExitScopes || {}
        );
      }
    });
  }

  return {
    bootstrapFromRecovery,
    startAutoSnapshotTimer,
    restartAutoSnapshotTimer,
    writeInitialAutoSnapshot,
    clearAutoSnapshotOnNewIngest,
    clearAutoSnapshotOnClose,
    syncAutoSnapshotAfterSave,
    flushRecoveryRecord,
    clearSessionStore,
    onDirty,
    onSaved,
    bindLifecycle,
    setSuppressBeforeUnload(value) {
      suppressBeforeUnload = Boolean(value);
    }
  };
}

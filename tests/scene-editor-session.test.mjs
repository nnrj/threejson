import assert from "node:assert/strict";
import { test } from "node:test";

/** 与 tools/old_version/scene-editor.html 内 resolveBootRestoreKind 保持一致（编辑器专用，不单独抽模块）。 */
function resolveBootRestoreKind(recovery) {
  if (!recovery || recovery.sessionDirty !== true) {
    return "default";
  }
  const snap = recovery.autoSnapshot;
  const stash = recovery.manualStash;
  if (!snap && !stash) {
    return "default";
  }
  if (snap && !stash) {
    return "snapshot_only";
  }
  if (!snap && stash) {
    return "stash_only";
  }
  const snapAt = Number(snap.updatedAt) || 0;
  const stashAt = Number(stash.updatedAt) || 0;
  if (snapAt > stashAt) {
    return "both_newer_snapshot";
  }
  if (stashAt > snapAt) {
    return "both_newer_stash";
  }
  return "both_same";
}

test("resolveBootRestoreKind default when clean or empty", () => {
  assert.equal(resolveBootRestoreKind(null), "default");
  assert.equal(resolveBootRestoreKind({ sessionDirty: false }), "default");
  assert.equal(resolveBootRestoreKind({ sessionDirty: true }), "default");
});

test("resolveBootRestoreKind snapshot vs stash ordering", () => {
  const base = {
    sessionDirty: true,
    autoSnapshot: { json: "{}", updatedAt: 100, fingerprint: "a" },
    manualStash: { json: "{}", updatedAt: 200, fingerprint: "b" }
  };
  assert.equal(resolveBootRestoreKind(base), "both_newer_stash");
  assert.equal(
    resolveBootRestoreKind({
      ...base,
      autoSnapshot: { ...base.autoSnapshot, updatedAt: 300 }
    }),
    "both_newer_snapshot"
  );
  assert.equal(resolveBootRestoreKind({ sessionDirty: true, autoSnapshot: base.autoSnapshot }), "snapshot_only");
});

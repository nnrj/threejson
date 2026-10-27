import assert from "node:assert/strict";
import test from "node:test";

import {
  PACKAGE_PLAN,
  assertMatchingPackageIntegrity,
  assertThreejsonPackMetadata,
  buildPublishPlan,
  nextPatch,
  nextPrerelease,
  resolveNpmInvocation,
  resolveExistingPackageAction,
  releaseVersionDefaults,
  packagesToPack,
  resolveFileComparison,
  runReleaseAllSteps,
  threejsonRuntimeCdnUrl,
  validateReleaseState,
  verifyExistingPackage,
  waitForThreejsonRuntimeCdn
} from "../tools/dev/release/threejson-release.mjs";

test("release plan follows the package dependency topology", () => {
  assert.deepEqual(PACKAGE_PLAN.map((item) => item.name), [
    "@threejson/assets",
    "threejson",
    "@threejson/audio-kit",
    "@threejson/media-kit",
    "@threejson/scene-tools",
    "@threejson/host-kit",
    "@threejson/editor-kit",
    "@threejson/player-kit",
    "@threejson/scene-agent-kit",
    "@threejson/react",
    "@threejson/react-scene-agent",
    "@threejson/react-ui"
  ]);
});

test("release version helpers increment prerelease and stable patch versions", () => {
  assert.equal(nextPrerelease("0.1.0-alpha.9"), "0.1.0-alpha.10");
  assert.equal(nextPrerelease("0.1.0"), "0.1.1-alpha.1");
  assert.equal(nextPatch("1.1.4"), "1.1.5");
});

test("release subprocesses invoke npm through Node instead of spawning npm.cmd on Windows", () => {
  const invocation = resolveNpmInvocation(["--version"]);
  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.args[0], /npm-cli\.js$/i);
  assert.deepEqual(invocation.args.slice(1), ["--version"]);
});

test("published versions are rejected by default and only explicit matching resumes may skip", () => {
  const root = PACKAGE_PLAN.find((item) => item.key === "threejson");
  const assets = PACKAGE_PLAN.find((item) => item.key === "assets");
  const published = { version: "0.1.0-alpha.10", integrity: "sha512-same" };
  assert.equal(resolveExistingPackageAction(root, null), "publish");
  assert.equal(resolveExistingPackageAction(root, published), "conflict");
  assert.equal(resolveExistingPackageAction(root, published, { resume: true }), "resume");
  assert.equal(resolveExistingPackageAction(assets, published), "reuse-assets");
});

test("resume integrity checks reject an already-published version with different content", () => {
  const root = PACKAGE_PLAN.find((item) => item.key === "threejson");
  const assets = PACKAGE_PLAN.find((item) => item.key === "assets");
  assert.equal(
    assertMatchingPackageIntegrity(
      root,
      { version: "0.1.0-alpha.10", integrity: "sha512-same" },
      { version: "0.1.0-alpha.10", integrity: "sha512-same" }
    ),
    true
  );
  assert.throws(
    () => assertMatchingPackageIntegrity(
      root,
      { version: "0.1.0-alpha.10", integrity: "sha512-local" },
      { version: "0.1.0-alpha.10", integrity: "sha512-published" }
    ),
    /归档摘要不同/
  );
  assert.throws(
    () => assertMatchingPackageIntegrity(
      assets,
      { version: "1.1.4", shasum: "local-assets" },
      { version: "1.1.4", shasum: "published-assets" }
    ),
    /归档摘要不同/
  );
});

test("threejson tarball gate requires runtime, document/session and optional compiled worker entries", () => {
  const valid = {
    files: [
      { path: "core/runtime.js" },
      { path: "core/timeline.js" },
      { path: "core/timeline.d.ts" },
      { path: "core/ai/index.js" },
      { path: "core/document.js" },
      { path: "core/session.js" },
      { path: "core/operations.js" },
      { path: "core/query.js" },
      { path: "core/geometry/geometryCompiler.js" },
      { path: "core/geometry/geometry.worker.bundle.js" },
      { path: "core/modeling/index.js" },
      { path: "core/modeling/modeling.worker.bundle.js" },
      { path: "extensions/modeling-cad/index.js" },
      { path: "extensions/modeling-webgpu/index.js" },
      { path: "package.json" }
    ]
  };
  assert.equal(assertThreejsonPackMetadata(valid), true);
  assert.throws(() => assertThreejsonPackMetadata({ files: valid.files.filter((file) => file.path !== "core/modeling/modeling.worker.bundle.js") }), /modeling\.worker\.bundle\.js/);
  assert.throws(
    () => assertThreejsonPackMetadata({ files: [{ path: "package.json" }] }),
    /core\/runtime\.js/
  );
});

test("CDN gate checks the immutable runtime URL and waits until its export is visible", async () => {
  assert.equal(
    threejsonRuntimeCdnUrl("0.1.0-alpha.10"),
    "https://cdn.jsdelivr.net/npm/threejson@0.1.0-alpha.10/core/runtime.js"
  );
  const responses = [
    { ok: false, status: 404, text: async () => "" },
    { ok: true, status: 200, text: async () => "export { createJsonScene };" }
  ];
  let clock = 0;
  const result = await waitForThreejsonRuntimeCdn("0.1.0-alpha.10", {
    timeoutMs: 100,
    intervalMs: 10,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    fetchImpl: async () => responses.shift()
  });
  assert.equal(result.attempt, 2);
});

test("release state keeps package versions, peer ranges and CDN pins aligned", () => {
  const result = validateReleaseState();
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test("root package exposes the post-publish Git tag command", async () => {
  const { default: manifest } = await import("../package.json", { with: { type: "json" } });
  assert.equal(manifest.scripts["release:tag"], "node tools/dev/release/threejson-release.mjs tag");
  assert.equal(manifest.scripts["release:preflight"], "node tools/dev/release/threejson-release.mjs preflight");
});

test("assets-only version defaults preserve the prepared root and component versions", () => {
  const current = { threejson: "0.1.0-alpha.12", packages: "0.1.0-alpha.4", assets: "1.1.6" };
  assert.deepEqual(releaseVersionDefaults(current, { "only-assets": true }), { ...current, assets: "1.1.7" });
  assert.deepEqual(releaseVersionDefaults(current), { threejson: "0.1.0-alpha.13", packages: "0.1.0-alpha.5", assets: "1.1.6" });
  assert.throws(() => releaseVersionDefaults(current, { "only-assets": true, packages: "2.0.0" }), /不能/);
});

test("file comparison is prompted before use and can be skipped independently of publish confirmation", async () => {
  let asks = 0;
  const prompt = async (_question, fallback) => { asks++; assert.equal(fallback, "n"); return "n"; };
  assert.equal(await resolveFileComparison({}, prompt), false);
  assert.equal(asks, 1);
  assert.equal(await resolveFileComparison({ yes: true }, prompt), false);
  assert.equal(asks, 2);
  assert.equal(await resolveFileComparison({ "compare-files": true }, prompt), true);
  assert.equal(await resolveFileComparison({ "no-compare-files": true }, prompt), false);
  assert.equal(asks, 2);
  assert.equal(await resolveFileComparison({}, async () => "y"), true);
  await assert.rejects(resolveFileComparison({ "compare-files": true, "no-compare-files": true }, prompt), /不能同时/);
  await assert.rejects(resolveFileComparison({ "compare-files": "false" }, prompt), /不接受值/);
});

const assets = PACKAGE_PLAN[0];
const publishedAssets = { version: "1.1.6", integrity: "sha512-remote" };
const localAssets = { version: "1.1.6", integrity: "sha512-local" };
const noDifferences = { equal: true, added: [], removed: [], modified: [] };

test("skipping the optional diff never downloads a tarball or falsely accepts a mismatch", async () => {
  const compare = async () => assert.fail("must not download or unpack");
  assert.equal(await verifyExistingPackage(assets, publishedAssets, {
    inspect: async () => publishedAssets, compare, compareFiles: false, log: () => {}
  }), "archive-match");
  await assert.rejects(verifyExistingPackage(assets, publishedAssets, {
    inspect: async () => localAssets, compare, compareFiles: false, log: () => {}
  }), /已跳过逐文件对比.*不能确认/);
});

test("verified equal files allow reuse; cache invalidates when local or remote archive changes", async () => {
  let comparisons = 0;
  let local = { ...localAssets };
  const options = {
    inspect: async () => local, compareFiles: true, log: () => {}, verifiedContents: new Set(),
    compare: async () => { comparisons++; return { diff: noDifferences, metadata: local }; }
  };
  assert.equal(await verifyExistingPackage(assets, publishedAssets, options), "contents-match");
  assert.equal(await verifyExistingPackage(assets, publishedAssets, options), "contents-match");
  assert.equal(comparisons, 1);
  local = { ...local, integrity: "sha512-local-changed" };
  await verifyExistingPackage(assets, publishedAssets, options);
  assert.equal(comparisons, 2);
  await verifyExistingPackage(assets, { ...publishedAssets, integrity: "sha512-remote-changed" }, options);
  assert.equal(comparisons, 3);
});

test("real differences and comparison failures cannot be bypassed by resume", async () => {
  const options = { inspect: async () => localAssets, compareFiles: true, resume: true, log: () => {} };
  await assert.rejects(verifyExistingPackage(assets, publishedAssets, { ...options,
    compare: async () => ({ metadata: localAssets, diff: { equal: false, added: ["new.bin"], removed: [], modified: ["package.json"] } })
  }), /必须升级版本号[\s\S]*new\.bin[\s\S]*package\.json/);
  await assert.rejects(verifyExistingPackage(assets, publishedAssets, { ...options,
    compare: async () => { throw new Error("Network failed"); }
  }), /Network failed/);
});

test("preflight validates reuse before preparing the release pack list", async () => {
  const versions = { assets: "1.1.6", threejson: "0.1.0-alpha.12", packages: "0.1.0-alpha.4" };
  const verified = [];
  const plan = await buildPublishPlan(versions, {
    lookup: async (name) => name === assets.name ? publishedAssets : null,
    verify: async (item) => { verified.push(item.name); }
  });
  assert.deepEqual(verified, [assets.name]);
  assert.equal(plan[0].action, "reuse-assets");
  assert.equal(packagesToPack(plan).length, 11);
  assert.equal(packagesToPack().length, 12);
  assert.equal(packagesToPack(plan).some((item) => item.key === "assets"), false);
  await assert.rejects(buildPublishPlan(versions, {
    lookup: async (_name, version) => ({ version }), verify: async () => assert.fail("conflicts checked first")
  }), /默认禁止/);
});

test("one-click preflight fails before tests, formal packing or publishing", async () => {
  const calls = [];
  await assert.rejects(runReleaseAllSteps({
    version: () => calls.push("version"),
    preflight: () => { calls.push("preflight"); throw new Error("changed assets"); },
    test: () => calls.push("test"), pack: () => calls.push("pack"), publish: () => calls.push("publish")
  }), /changed assets/);
  assert.deepEqual(calls, ["version", "preflight"]);
  calls.length = 0;
  const plan = [];
  await runReleaseAllSteps({
    version: () => calls.push("version"), preflight: () => { calls.push("preflight"); return plan; },
    test: () => calls.push("test"), pack: (value) => { assert.equal(value, plan); calls.push("pack"); },
    publish: () => calls.push("publish")
  });
  assert.deepEqual(calls, ["version", "preflight", "test", "pack", "publish"]);
});

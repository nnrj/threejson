import assert from "node:assert/strict";
import test from "node:test";

import {
  PACKAGE_PLAN,
  assertMatchingPackageIntegrity,
  assertThreejsonPackMetadata,
  nextPatch,
  nextPrerelease,
  resolveNpmInvocation,
  resolveExistingPackageAction,
  threejsonRuntimeCdnUrl,
  validateReleaseState,
  waitForThreejsonRuntimeCdn
} from "../tools/dev/release/threejson-release.mjs";

test("release plan follows the package dependency topology", () => {
  assert.deepEqual(PACKAGE_PLAN.map((item) => item.name), [
    "@threejson/assets",
    "threejson",
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
    /必须升级版本号/
  );
  assert.throws(
    () => assertMatchingPackageIntegrity(
      assets,
      { version: "1.1.4", shasum: "local-assets" },
      { version: "1.1.4", shasum: "published-assets" }
    ),
    /必须升级版本号/
  );
});

test("threejson tarball gate requires the runtime and AI package entries", () => {
  const valid = {
    files: [
      { path: "core/runtime.js" },
      { path: "core/ai/index.js" },
      { path: "package.json" }
    ]
  };
  assert.equal(assertThreejsonPackMetadata(valid), true);
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
});

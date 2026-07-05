import { test } from "node:test";
import assert from "node:assert/strict";

import { runGenerateSubdomain } from "../tools/dev/build/generate-subdomain.mjs";

test("dry-run deployable scaffold emits leaf api names", () => {
  const result = runGenerateSubdomain([
    "weather",
    "snowTrial",
    "--dry-run",
    "--no-manifest"
  ]);
  assert.equal(result.qualifiedId, "weather.snowTrial");
  assert.equal(result.dryRun, true);
  const indexFile = result.files.find((p) => p.endsWith("index.js"));
  assert.ok(indexFile);
});

test("dry-run namespace-only scaffold", () => {
  const result = runGenerateSubdomain([
    "weather",
    "particleNs",
    "--namespace-only",
    "--dry-run",
    "--no-manifest"
  ]);
  assert.equal(result.qualifiedId, "weather.particleNs");
  assert.equal(result.dryRun, true);
});

test("rejects missing parent directory", () => {
  assert.throws(
    () =>
      runGenerateSubdomain([
        "notARealDomainFolder",
        "leaf",
        "--dry-run",
        "--no-manifest"
      ]),
    /parent directory missing/
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const json = (file) => JSON.parse(read(file));

// Evaluate each ignore file on its own: the real .gitignore must not override
// .assetsignore (notably its allowlist for the root npm lockfile).
function ignoredBy(file, candidates) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "threejson-site-ignores-"));
  const git = (args, input) => spawnSync("git", args, {
    cwd: directory, encoding: "utf8", windowsHide: true, input,
  });
  try {
    const init = git(["init", "--quiet"]);
    assert.equal(init.status, 0, init.stderr || init.error?.message);
    fs.writeFileSync(path.join(directory, ".gitignore"), read(file));
    const checked = git(
      ["-c", "core.excludesFile=", "check-ignore", "--no-index", "--stdin"],
      candidates.join("\n") + "\n",
    );
    assert.ok([0, 1].includes(checked.status), checked.stderr || checked.error?.message);
    return new Set(checked.stdout.trim().split(/\r?\n/).filter(Boolean));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("site deployment directly declares and locks Wrangler without borrowing it from an app", () => {
  const manifest = json("package.json");
  const lock = json("package-lock.json");
  const version = manifest.devDependencies?.wrangler;
  assert.match(version ?? "", /^\d+\.\d+\.\d+$/, "Root Wrangler must have an explicit, pinned version");
  assert.equal(manifest.dependencies?.wrangler, undefined, "Wrangler is not an engine runtime dependency");
  assert.equal(lock.packages[""].devDependencies.wrangler, version);
  assert.equal(lock.packages["node_modules/wrangler"].version, version);
  assert.ok(lock.packages["node_modules/wrangler"].integrity);
  assert.ok(lock.packages["node_modules/wrangler"].bin.wrangler);
  assert.deepEqual(lock.packages[""].devDependencies, manifest.devDependencies);
});

test("only the root npm lockfile is allowed through the existing Git ignore policy", () => {
  const ignored = ignoredBy(".gitignore", [
    "package-lock.json", "apps/new-app/package-lock.json",
    "examples/new-demo/package-lock.json", "node_modules/wrangler/package.json",
  ]);
  assert.ok(!ignored.has("package-lock.json"));
  assert.ok(ignored.has("apps/new-app/package-lock.json"));
  assert.ok(ignored.has("examples/new-demo/package-lock.json"));
  assert.ok(ignored.has("node_modules/wrangler/package.json"));
});

test("deployment excludes installation artifacts while preserving the native site", () => {
  const excluded = [
    "package-lock.json", "bun.lock", "bun.lockb", ".cache/site-check/log.txt",
    "node_modules/wrangler/bin/wrangler.js", "apps/threebox/node_modules/.bin/wrangler",
  ];
  const included = [
    "index.html", "website/index.html", "core/index.js", "assets/img/favicon.ico",
    "tools/scene-host/threebox/index.html", "packages/media-kit/js/shotOperations.js",
    "docs/en/timeline-media.md", "docs/zh/timeline-media.md",
  ];
  const ignored = ignoredBy(".assetsignore", [...excluded, ...included]);
  for (const file of excluded) assert.ok(ignored.has(file), `Development artifact exposed: ${file}`);
  for (const file of included) assert.ok(!ignored.has(file), `Runtime file excluded: ${file}`);
});

test("site scripts and CI check the same static deployment without uploading", () => {
  const manifest = json("package.json");
  const config = json("wrangler.jsonc");
  assert.equal(config.assets.directory, "./");
  assert.equal(manifest.scripts["deploy:site"], "wrangler deploy --config wrangler.jsonc");
  assert.equal(manifest.scripts["check:site"], `${manifest.scripts["deploy:site"]} --dry-run`);
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /run: npm ci --include=dev/);
  assert.match(ci, /run: npm run check:site/);
  assert.doesNotMatch(ci, /run: (?:npx wrangler deploy|npm run deploy:site)\s*$/m);
});

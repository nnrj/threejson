import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  SCENE_PREVIEW_ALLOWED_ORIGINS,
  configureScenePreviewAllowedOrigins,
  isScenePreviewAllowedOrigin,
  postScenePreviewMessage,
  resolveScenePreviewOpenerOrigin,
  resolveScenePreviewPeerOrigin
} from "../tools/scene-host/shared/js/scenePreviewProtocol.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPS = ["scene-editor", "scene-player", "scene-shower", "threebox"];
const REQUIRED_PRODUCTION_ORIGINS = [
  "https://threejson.org",
  "https://threebox.org",
  "https://cloud.threebox.org",
  "https://editor.threejson.org",
  "https://player.threejson.org",
  "https://shower.threejson.org"
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function linePattern(value) {
  return new RegExp(`^${String(value).replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")}$`, "m");
}

test("root deployment ignore list excludes non-runtime projects and credentials", () => {
  const ignore = read(".assetsignore");
  for (const entry of [
    "servertmp/",
    "apps/",
    "packages/*",
    "tests/",
    "**/dist/",
    "docs/dev/",
    ".claude/",
    ".dev.vars",
    ".env",
    "*.test.json"
  ]) {
    assert.match(ignore, linePattern(entry), entry);
  }
});

test("deployment includes opt-in media modules without exposing other packages or secrets", () => {
  const included = ["packages/audio-kit/js/index.js", "packages/audio-kit/js/models.js", "packages/media-kit/js/index.js", "packages/media-kit/js/gifWorkerRuntime.js", "packages/host-kit/js/mediaStudio.js", "packages/host-kit/js/mediaNarrationPanel.js", "packages/host-kit/js/mediaNarrationExport.js", "packages/host-kit/js/audioModelPanel.js", "packages/host-kit/js/localSpeech.js"];
  const excluded = ["packages/scene-tools/js/index.js", "packages/host-kit/js/aiTurnOrchestrator.js", "packages/audio-kit/js/nodeModels.js", "packages/audio-kit/package.json", "packages/media-kit/.env", "packages/audio-kit/js/.dev.vars", "servertmp/threebox-server/.dev.vars"];
  // Cloudflare documents .assetsignore as gitignore syntax. Use the actual Git
  // matcher, including parent-directory exclusion rules, not regex approximations.
  const checked = spawnSync("git", ["-c", `core.excludesFile=${path.join(REPO_ROOT, ".assetsignore")}`, "check-ignore", "--no-index", "--stdin"], { cwd: REPO_ROOT, input: [...included, ...excluded].join("\n") + "\n", encoding: "utf8", windowsHide: true });
  assert.equal(checked.status, 0, checked.stderr || checked.error?.message);
  const ignored = new Set(checked.stdout.trim().split(/\r?\n/));
  for (const file of included) assert.ok(!ignored.has(file), `Runtime file excluded: ${file}`);
  for (const file of excluded) assert.ok(ignored.has(file), `Development/private file exposed: ${file}`);
});

test("each React product carries independent Cloudflare deployment hygiene", () => {
  for (const app of APPS) {
    const base = `apps/${app}`;
    const gitignore = read(`${base}/.gitignore`);
    const assetsignore = read(`${base}/.assetsignore`);
    const wrangler = JSON.parse(read(`${base}/wrangler.jsonc`).replace(/^\s*\/\/.*$/gm, ""));
    const manifest = JSON.parse(read(`${base}/package.json`));

    for (const entry of ["node_modules/", "dist/", ".wrangler/", ".dev.vars", ".env", "*.test.json"]) {
      assert.match(gitignore, linePattern(entry), `${base}/.gitignore: ${entry}`);
    }
    for (const entry of ["node_modules/", "src/", ".dev.vars", ".env", "*.test.json"]) {
      assert.match(assetsignore, linePattern(entry), `${base}/.assetsignore: ${entry}`);
    }
    assert.equal(wrangler.assets?.directory, "./dist");
    assert.equal(wrangler.assets?.not_found_handling, "single-page-application");
    assert.equal(manifest.scripts?.deploy, "npm run build && wrangler deploy");
    assert.equal(manifest.scripts?.["versions:upload"], "npm run build && wrangler versions upload");
    assert.ok(manifest.devDependencies?.wrangler, `${base} needs a local wrangler dependency`);
  }
});

test("legacy preview protocol accepts same-origin hosts and only explicit cross-origin peers", () => {
  for (const origin of REQUIRED_PRODUCTION_ORIGINS) {
    assert.equal(isScenePreviewAllowedOrigin(origin), true, origin);
  }
  assert.equal(isScenePreviewAllowedOrigin("https://untrusted.example"), false);
  assert.equal(
    resolveScenePreviewPeerOrigin("https://editor.threejson.org/", "https://threejson.org/"),
    "https://editor.threejson.org"
  );
  assert.equal(
    resolveScenePreviewPeerOrigin("https://untrusted.example/", "https://threejson.org/"),
    null
  );
  assert.equal(
    resolveScenePreviewPeerOrigin("/player/", "http://localhost:5173/editor/"),
    "http://localhost:5173"
  );
  assert.equal(
    resolveScenePreviewPeerOrigin(
      "https://self-hosted-player.example/",
      "https://self-hosted-editor.example/",
      ["https://self-hosted-player.example"]
    ),
    "https://self-hosted-player.example"
  );
  assert.equal(
    resolveScenePreviewOpenerOrigin(
      { search: "?openerOrigin=https%3A%2F%2Fself-hosted-editor.example" },
      undefined,
      "https://self-hosted-editor.example/editor/"
    ),
    "https://self-hosted-editor.example"
  );

  const sent = [];
  const target = { closed: false, postMessage: (...args) => sent.push(args) };
  assert.equal(postScenePreviewMessage(target, { action: "load" }), false);
  assert.equal(postScenePreviewMessage(target, { action: "load" }, "https://untrusted.example"), false);
  assert.equal(postScenePreviewMessage(target, { action: "load" }, "https://player.threejson.org"), true);
  assert.equal(
    postScenePreviewMessage(
      target,
      { action: "load" },
      "https://self-hosted-player.example",
      ["https://self-hosted-player.example"]
    ),
    true
  );
  assert.equal(sent.length, 2);
  assert.equal(sent[0][1], "https://player.threejson.org");
  assert.equal(sent[1][1], "https://self-hosted-player.example");
  assert.ok(SCENE_PREVIEW_ALLOWED_ORIGINS.includes("https://player.threejson.org"));

  configureScenePreviewAllowedOrigins(["https://configured-preview.example/path"]);
  assert.equal(isScenePreviewAllowedOrigin("https://configured-preview.example"), true);
  configureScenePreviewAllowedOrigins([]);
});

test("React applications keep their own explicit handshake sources", () => {
  const sourceFiles = [
    "apps/scene-editor/src/sceneTransferProtocol.js",
    "apps/scene-player/src/scenePreviewProtocol.js",
    "apps/scene-shower/src/sceneTransferProtocol.js",
    "apps/threebox/src/sceneBridgeProtocol.js"
  ];
  for (const file of sourceFiles) {
    const source = read(file);
    for (const origin of REQUIRED_PRODUCTION_ORIGINS) {
      assert.ok(source.includes(origin), `${file} must declare ${origin}`);
    }
    assert.doesNotMatch(source, /from\s*["'][^"']*tools\/scene-host/);
    assert.ok(source.includes("openerOrigin"), `${file} must make the peer origin explicit`);
  }

  assert.match(read("apps/threebox/src/sceneBridgeProtocol.js"), /window\.open\(/);
  assert.match(read("apps/scene-shower/src/sceneTransferProtocol.js"), /window\.open\(/);
  assert.match(read("apps/scene-editor/src/sceneTransferProtocol.js"), /bridgeSession/);
  assert.match(read("apps/scene-player/src/scenePreviewProtocol.js"), /bridgeSession/);
});

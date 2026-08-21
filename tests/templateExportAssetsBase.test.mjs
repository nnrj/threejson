import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CDN_ASSETS_BASE, ASSETS_PACKAGE_VERSION } from "threejson/assets";
import {
  buildHtmlTemplate,
  buildReactFiles,
  buildVueFiles,
  buildElectronFiles,
  TEMPLATE_THREEJSON_VERSION
} from "@threejson/host-kit/js/templateExportBuilders.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The @threejson/assets CDN version has exactly ONE literal home: core/util/assetsBase.js's
// ASSETS_PACKAGE_VERSION (surfaced as DEFAULT_CDN_ASSETS_BASE on threejson/core), already guarded
// against the installed devDependency by tests/assetsBase.test.mjs. templateExportBuilders used to
// hardcode its own copy of that version; these tests ensure it now derives from the single source,
// so a re-introduced literal (or a bump that misses the exporter) fails `npm test`.
test("exported project templates embed the single-source @threejson/assets CDN base (no drift-prone literal)", () => {
  const expected = `${DEFAULT_CDN_ASSETS_BASE}/`;
  const outputs = {
    html: buildHtmlTemplate({ sceneJsonText: "{}", inlineJson: true }),
    react: buildReactFiles()["src/main.jsx"],
    vue: buildVueFiles()["src/main.js"],
    electron: buildElectronFiles()["src/renderer.js"]
  };
  for (const [kind, output] of Object.entries(outputs)) {
    assert.ok(
      output.includes(expected),
      `exported ${kind} template must load assets from DEFAULT_CDN_ASSETS_BASE ("${DEFAULT_CDN_ASSETS_BASE}") — a templateExportBuilders literal has drifted from core/util/assetsBase.js (installed @threejson/assets@${ASSETS_PACKAGE_VERSION}).`
    );
    // Every @threejson/assets@<version> reference in the output must be the single-source version.
    for (const match of output.match(/@threejson\/assets@[\w.-]+/g) || []) {
      assert.equal(
        match,
        `@threejson/assets@${ASSETS_PACKAGE_VERSION}`,
        `exported ${kind} template pins a stale @threejson/assets version: "${match}" (expected ${ASSETS_PACKAGE_VERSION}).`
      );
    }
  }
});

test("host-kit templateExportBuilders stays byte-identical to its tools/scene-host source", () => {
  const toolsCopy = fs.readFileSync(
    path.join(REPO_ROOT, "tools/scene-host/shared/js/templateExportBuilders.js"),
    "utf8"
  );
  const pkgCopy = fs.readFileSync(
    path.join(REPO_ROOT, "packages/host-kit/js/templateExportBuilders.js"),
    "utf8"
  );
  assert.equal(
    pkgCopy,
    toolsCopy,
    "packages/host-kit/js/templateExportBuilders.js has drifted from its tools/scene-host source — keep the vendored copy in sync."
  );
});

test("downloaded HTML pins the ThreeJSON runtime version without hiding unpublished entries", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(TEMPLATE_THREEJSON_VERSION, packageJson.version);

  const html = buildHtmlTemplate({ sceneJsonText: "{}", inlineJson: true });
  const escapedVersion = packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(html, new RegExp(`threejson@${escapedVersion}/core/runtime\\.js`));
  assert.doesNotMatch(html, /core\/index\.js|runtime-compat|falling back/i);
  assert.doesNotMatch(html, /npm\/threejson\/core\/runtime\.js/);
});

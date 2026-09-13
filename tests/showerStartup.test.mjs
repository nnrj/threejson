import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");

test("shower applies the shared theme before its stylesheet can paint", () => {
  const html = read("tools/scene-host/shower/index.html");
  const bootstrapAt = html.indexOf('localStorage.getItem("threejson.site.theme")');
  const stylesheetAt = html.indexOf('href="./css/shower.css"');

  assert.ok(bootstrapAt >= 0, "the first-paint theme bootstrap is missing");
  assert.ok(stylesheetAt > bootstrapAt, "the theme bootstrap must run before shower.css");
  assert.match(html, /document\.documentElement\.dataset\.theme\s*=\s*actual/);
  assert.doesNotMatch(html, /<script[^>]+src="https:\/\/cdn\.jsdelivr\.net\/npm\/codemirror/);
});

test("shower has a light no-JavaScript fallback and an immediate loading state", () => {
  const html = read("tools/scene-host/shower/index.html");
  const css = read("tools/scene-host/shower/css/shower.css");

  assert.match(css, /^:root\s*\{[\s\S]*?color-scheme:\s*light;/);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{[\s\S]*?color-scheme:\s*dark;/);
  assert.match(html, /id="loadingMask" class="visible" role="status"/);
  assert.match(html, /class="loadingSpinner"/);
  assert.match(html, /class="editorLoadingPlaceholder"/);
  assert.match(html, /id="statusText">正在加载\.\.\.<\/span>/);
  assert.match(css, /#loadingMask\.visible\s*\{\s*display:\s*flex;/);
});

test("shower editor fills its pane even when CodeMirror CSS loads after host CSS", () => {
  const css = read("tools/scene-host/shower/css/shower.css");
  assert.match(css, /\.editorPanel\s*\{\s*height:\s*100%;\s*\}/);
  assert.match(css, /\.editorPanel\s*>\s*\.CodeMirror\s*\{[^}]*height:\s*100%;/s);
});

test("shower startup excludes export-only dependencies and the aggregate core entry", () => {
  const main = read("tools/scene-host/shower/js/main.js");

  assert.doesNotMatch(main, /^import .* from "fflate";/m);
  assert.doesNotMatch(main, /from "threejson"/);
  assert.match(main, /from "\.\.\/\.\.\/\.\.\/\.\.\/core\/runtime\.js"/);
  assert.match(main, /await import\("\.\.\/\.\.\/shared\/js\/templateExportBuilders\.js"\)/);
  assert.match(main, /await import\("fflate"\)/);
  assert.match(main, /await import\("\.\.\/\.\.\/\.\.\/\.\.\/core\/handler\/meshExportHandler\.js"\)/);
  assert.match(main, /const initialScenePromise = loadInitialJson\(\);[\s\S]*const editorPromise = initializeCodeEditor\(\);/);
  assert.match(main, /async function loadCodeMirror\(\)[\s\S]*loadClassicScript/);
});

test("shower default scene exists and legacy template export has a browser-resolvable asset import", () => {
  const main = read("tools/scene-host/shower/js/main.js");
  const html = read("tools/scene-host/shower/index.html");
  const editorHtml = read("tools/scene-host/editor/index.html");
  const templateBuilder = read("tools/scene-host/shared/js/templateExportBuilders.js");
  const defaultMatch = main.match(/params\.get\("json"\) \|\| "([^"]+)"/);

  assert.ok(defaultMatch, "the default shower scene path is missing");
  assert.ok(fs.existsSync(path.join(REPO_ROOT, defaultMatch[1])), `missing default scene: ${defaultMatch[1]}`);
  assert.match(templateBuilder, /from "threejson\/assets"/);
  assert.match(html, /"threejson\/assets"\s*:\s*"\.\.\/\.\.\/\.\.\/core\/assets\.js"/);
  assert.match(editorHtml, /"threejson\/assets"\s*:\s*"\.\.\/\.\.\/\.\.\/core\/assets\.js"/);
});

test("shower activates optional capabilities and prepares scene changes before retiring the old viewport", () => {
  const main = read("tools/scene-host/shower/js/main.js"), html = read("tools/scene-host/shower/index.html");
  assert.match(main, /ensureCapabilities:\s*ensureSceneHostSceneCapabilitiesForPayload/);
  assert.match(main, /createViewport:\s*\(\) => createSceneCardViewport/);
  assert.match(main, /await sceneSession\.render\(nextJson/);
  assert.doesNotMatch(main, /runtime\?\.dispose\?\.\(\)/);
  for (const entry of ["threejson/document", "threejson/session", "threejson/webgpu", "threejson/tsl-code", "three/webgpu", "three/tsl"]) assert.ok(html.includes(`"${entry}":`));
  assert.match(main, /fetch\(url, \{ signal: controller\.signal \}\)/);
  assert.match(main, /if \(event\.target !== els\.canvas\) return/);
});

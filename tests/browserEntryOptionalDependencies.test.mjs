import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function collectStaticModuleReferences(source, { includeDynamic = false } = {}) {
  const code = source
    // Template builders contain complete JavaScript source files inside backtick strings. Those
    // imports belong to the generated application, not to the scene host executing this module.
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "\"\"")
    // Remove whole-line comments first: text such as `apps/*` inside a `//` comment must not be
    // mistaken for the beginning of a block comment that hides subsequent exports.
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const references = [];
  const patterns = [
    /^[ \t]*import\s+(?:[^"'()]*?\s+from\s*)?["']([^"']+)["']/gm,
    /^[ \t]*export\s+(?:\*|\{[\s\S]*?\})\s+from\s*["']([^"']+)["']/gm
  ];
  if (includeDynamic) patterns.push(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g);
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) references.push(match[1]);
  }
  return references;
}

test("static entry scanner is not confused by block-comment tokens inside line comments", () => {
  const source = `// apps/* are consumers, not runtime dependencies\nexport * from "./visible.js";`;
  assert.deepEqual(collectStaticModuleReferences(source), ["./visible.js"]);
});

function resolveLocalModule(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const resolved = path.resolve(path.dirname(importer), specifier);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  if (!path.extname(resolved) && fs.existsSync(`${resolved}.js`)) return `${resolved}.js`;
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const indexFile = path.join(resolved, "index.js");
    if (fs.existsSync(indexFile)) return indexFile;
  }
  throw new Error(`Cannot resolve static module ${specifier} from ${path.relative(REPO_ROOT, importer)}`);
}

function collectTransitiveBareSpecifiers(entryFile, options = {}) {
  const pending = [entryFile];
  const visited = new Set();
  const bareSpecifiers = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const specifier of collectStaticModuleReferences(source, options)) {
      const localFile = resolveLocalModule(file, specifier);
      if (localFile) pending.push(localFile);
      else bareSpecifiers.add(specifier);
    }
  }
  return bareSpecifiers;
}

function readImportMap(htmlFile) {
  const html = fs.readFileSync(htmlFile, "utf8");
  const match = html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(match, `${path.relative(REPO_ROOT, htmlFile)} must contain an import map`);
  return JSON.parse(match[1]).imports || {};
}

function importMapCovers(imports, specifier) {
  if (Object.prototype.hasOwnProperty.call(imports, specifier)) return true;
  return Object.keys(imports).some((key) => key.endsWith("/") && specifier.startsWith(key));
}

test("ordinary browser entries keep optional fflate outside their static dependency graph", () => {
  const entries = [
    {
      entry: path.join(REPO_ROOT, "core", "index.js"),
      demo: path.join(REPO_ROOT, "examples", "html-demo", "track-00-runtime", "00-01-minimal-mesh.html")
    },
    {
      entry: path.join(REPO_ROOT, "builtins", "full.js"),
      demo: path.join(REPO_ROOT, "examples", "html-demo", "track-00-runtime", "00-02-primitives-materials.html")
    }
  ];

  for (const { entry, demo } of entries) {
    const bareSpecifiers = collectTransitiveBareSpecifiers(entry);
    const imports = readImportMap(demo);
    assert.equal(bareSpecifiers.has("fflate"), false, `${path.relative(REPO_ROOT, entry)} must keep archive compression lazy`);
    const missing = [...bareSpecifiers].filter((specifier) => !importMapCovers(imports, specifier)).sort();
    assert.deepEqual(
      missing,
      [],
      `${path.relative(REPO_ROOT, demo)} is missing mappings for static browser dependencies`
    );
  }
});

test("native scene-host import maps cover every bare specifier in their application graph", () => {
  const hosts = [
    ["editor", "tools/scene-host/editor/js/main.js", "tools/scene-host/editor/index.html"],
    ["player", "tools/scene-host/player/js/main.js", "tools/scene-host/player/index.html"],
    ["shower", "tools/scene-host/shower/js/main.js", "tools/scene-host/shower/index.html"],
    ["video-editor", "tools/scene-host/video-editor/js/app.js", "tools/scene-host/video-editor/index.html"],
    ["threebox", "tools/scene-host/threebox/js/threeBoxApp.js", "tools/scene-host/threebox/index.html"]
  ];

  for (const [name, entryRelative, htmlRelative] of hosts) {
    const entry = path.join(REPO_ROOT, ...entryRelative.split("/"));
    const html = path.join(REPO_ROOT, ...htmlRelative.split("/"));
    const imports = readImportMap(html);
    const missing = [...collectTransitiveBareSpecifiers(entry, { includeDynamic: true })]
      .filter((specifier) => !importMapCovers(imports, specifier))
      .sort();
    assert.deepEqual(missing, [], `${name} import map is missing mappings for its application graph`);
  }
});

test("ThreeJSON root and AI entries expose the shared scene parser used by native Editor", async () => {
  const [rootEntry, aiEntry] = await Promise.all([
    import("../builtins/full.js"),
    import("../core/ai/index.js")
  ]);
  assert.equal(typeof rootEntry.parseSceneJsonString, "function");
  assert.equal(rootEntry.parseSceneJsonString, aiEntry.parseSceneJsonString);
  assert.equal(rootEntry.parseSceneJsonString('{"worldInfo":{"boxModelList":[]}}').worldInfo.boxModelList, undefined);
});

test("minimal runtime entry has no static optional-capability dependency", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(packageJson.exports?.["./runtime"], "./core/runtime.js");

  const entry = path.join(REPO_ROOT, "core", "runtime.js");
  const bareSpecifiers = collectTransitiveBareSpecifiers(entry);
  for (const optional of [
    "fflate",
    "gifuct-js",
    "html2canvas-pro",
    "three-bvh-csg",
    "three-mesh-bvh",
    "troika-three-text"
  ]) {
    assert.equal(bareSpecifiers.has(optional), false, `threejson/runtime must keep ${optional} lazy`);
  }

  const demo = path.join(
    REPO_ROOT,
    "examples",
    "html-demo",
    "track-00-runtime",
    "00-01-minimal-mesh.html"
  );
  const imports = readImportMap(demo);
  const missing = [...bareSpecifiers].filter((specifier) => !importMapCovers(imports, specifier)).sort();
  assert.deepEqual(missing, []);
  assert.equal(imports.fflate, undefined);
  assert.equal(imports["three-bvh-csg"], undefined);
  assert.equal(imports["html2canvas-pro"], undefined);
});

test("optional runtime packages are optional peers, not default dependencies", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  for (const name of [
    "fflate",
    "gifuct-js",
    "html2canvas-pro",
    "three-bvh-csg",
    "three-mesh-bvh",
    "troika-three-text"
  ]) {
    assert.equal(packageJson.dependencies?.[name], undefined, `${name} must not install for every consumer`);
    assert.ok(packageJson.peerDependencies?.[name], `${name} needs an explicit optional peer range`);
    assert.equal(packageJson.peerDependenciesMeta?.[name]?.optional, true);
    assert.ok(packageJson.devDependencies?.[name], `${name} remains installed for repository tests`);
  }
});

test("optional peers use bundler-safe static namespace imports", () => {
  const optionalPeers = new Set([
    "fflate",
    "gifuct-js",
    "html2canvas-pro",
    "three-bvh-csg",
    "three-mesh-bvh",
    "troika-three-text"
  ]);
  const pending = [path.join(REPO_ROOT, "core")];
  while (pending.length) {
    const entry = pending.pop();
    for (const item of fs.readdirSync(entry, { withFileTypes: true })) {
      const target = path.join(entry, item.name);
      if (item.isDirectory()) {
        pending.push(target);
        continue;
      }
      if (!item.isFile() || !item.name.endsWith(".js")) continue;
      const source = fs.readFileSync(target, "utf8");
      const imports = source.matchAll(
        /^[ \t]*import\s+([^;]+?)\s+from\s+["']([^"']+)["']\s*;/gm
      );
      for (const match of imports) {
        if (!optionalPeers.has(match[2])) continue;
        assert.match(
          match[1].trim(),
          /^\*\s+as\s+/,
          `${path.relative(REPO_ROOT, target)} must use a namespace import for optional peer ${match[2]} so a bundler's missing-peer stub can link`
        );
      }
    }
  }
});

test("archive support has an explicit package subpath and scene-editor opts into it", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(packageJson.exports?.["./archive"], "./core/archive/index.js");

  const coreIndex = fs.readFileSync(path.join(REPO_ROOT, "core", "index.js"), "utf8");
  assert.match(coreIndex, /archive\/lazyArchiveApi\.js/);
  assert.doesNotMatch(coreIndex, /export\s+\*\s+from\s+["']\.\/archive\/tjz(?:Packager|Archive)\.js["']/);

  const appSource = fs.readFileSync(path.join(REPO_ROOT, "apps", "scene-editor", "src", "App.jsx"), "utf8");
  const exportSource = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "scene-editor", "src", "lib", "editorTjzExport.js"),
    "utf8"
  );
  assert.match(appSource, /from\s+["']threejson\/archive["']/);
  assert.match(exportSource, /from\s+["']threejson\/archive["']/);
});

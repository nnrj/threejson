import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".html",
  ".css"
]);
const SCENE_HOST_APPS = new Set(["editor", "player", "shower", "threebox"]);

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".vite", ".wrangler", "coverage"]);

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(target));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

function collectModuleReferences(file) {
  const source = fs.readFileSync(file, "utf8");
  const references = [];
  const patterns = [
    /(?:^|[;\n])\s*(?:import|export)\s+(?:type\s+)?(?:[^"'();]*?\s+from\s*)?["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /(?:src|href)\s*=\s*["']([^"']+\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts|css))(?:[?#][^"']*)?["']/g,
    /@import\s+(?:url\()?\s*["']([^"']+)["']/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) references.push(match[1]);
  }
  return references;
}

function resolveLocalReference(file, reference) {
  if (!reference.startsWith(".")) return null;
  return path.resolve(path.dirname(file), reference);
}

function relative(file) {
  return path.relative(REPO_ROOT, file).replaceAll("\\", "/");
}

test("core never reverse-imports domains, extensions, packages, apps, or host tools", () => {
  const forbiddenRoots = ["domains", "extensions", "packages", "apps", "tools"].map(
    (dir) => path.join(REPO_ROOT, dir) + path.sep
  );
  const violations = [];
  for (const file of walkFiles(path.join(REPO_ROOT, "core"))) {
    for (const reference of collectModuleReferences(file)) {
      const resolved = resolveLocalReference(file, reference);
      if ((resolved && forbiddenRoots.some((root) => resolved.startsWith(root))) || /^threejson\/(?:domains|extensions)(?:\/|$)/.test(reference)) {
        violations.push(`${relative(file)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("architecture scans include React and TypeScript source extensions", () => {
  const appFiles = walkFiles(path.join(REPO_ROOT, "apps"));
  assert.ok(appFiles.some((file) => file.endsWith("App.jsx")), "apps/*.jsx must be part of boundary scans");
  assert.ok(SOURCE_EXTENSIONS.has(".tsx"), "future TSX app sources must remain covered");
});

test("lightweight host-kit helpers never import aggregate ThreeJSON entries", () => {
  const lightModules = [
    "buildSceneHostRuntimeConfig.js",
    "mergeSceneHelpers.js",
    "sceneHostPaths.js",
    "templateExportBuilders.js"
  ];
  const violations = [];
  for (const name of lightModules) {
    const file = path.join(REPO_ROOT, "packages", "host-kit", "js", name);
    for (const reference of collectModuleReferences(file)) {
      if (reference === "threejson" || reference === "threejson/core") {
        violations.push(`${relative(file)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("applications consume React packages through capability subpaths", () => {
  const violations = [];
  for (const file of walkFiles(path.join(REPO_ROOT, "apps"))) {
    for (const reference of collectModuleReferences(file)) {
      if (reference === "@threejson/react" || reference === "@threejson/react-ui") {
        violations.push(`${relative(file)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("React packages publish stable capability subpaths", () => {
  const reactManifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "packages", "react", "package.json"), "utf8")
  );
  const uiManifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "packages", "react-ui", "package.json"), "utf8")
  );
  const sceneAgentManifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "packages", "scene-agent-kit", "package.json"), "utf8")
  );
  const reactSceneAgentManifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "packages", "react-scene-agent", "package.json"), "utf8")
  );
  for (const subpath of [
    "./i18n",
    "./player-settings",
    "./playlist",
    "./scene-player",
    "./viewport"
  ]) {
    assert.ok(reactManifest.exports?.[subpath], subpath);
  }
  assert.ok(uiManifest.exports?.["./mesh-export"]);
  assert.ok(uiManifest.exports?.["./scene-tree"]);
  for (const subpath of ["./contracts", "./controller", "./repository", "./settings", "./turn-state"]) {
    assert.ok(sceneAgentManifest.exports?.[subpath], subpath);
    assert.notEqual(sceneAgentManifest.exports[subpath].types, "./index.d.ts", `${subpath} needs capability-scoped types`);
  }
  for (const subpath of ["./conversations", "./scene-card", "./scene-card-runtime", "./progress", "./preview-lights", "./scene-load-queue", "./styles.css"]) {
    assert.ok(reactSceneAgentManifest.exports?.[subpath], subpath);
    if (subpath !== "./styles.css") {
      assert.notEqual(reactSceneAgentManifest.exports[subpath].types, "./index.d.ts", `${subpath} needs capability-scoped types`);
    }
  }
});

test("scene-agent packages stay optional, unbranded, and free of product service URLs", () => {
  const roots = [
    path.join(REPO_ROOT, "packages", "scene-agent-kit"),
    path.join(REPO_ROOT, "packages", "react-scene-agent")
  ];
  const violations = [];
  for (const root of roots) {
    for (const file of walkFiles(root)) {
      const source = fs.readFileSync(file, "utf8");
      if (/three[-_ ]?box/i.test(source)) violations.push(`${relative(file)} -> product branding`);
      if (/https?:\/\/(?:api\.)?threebox\.org/i.test(source)) violations.push(`${relative(file)} -> fixed ThreeBox service URL`);
      for (const reference of collectModuleReferences(file)) {
        if (reference.startsWith("@threejson/scene-agent-kit") && root.endsWith("scene-agent-kit")) continue;
        if (/apps\/threebox|tools\/scene-host\/threebox|threebox-cloud/i.test(reference)) {
          violations.push(`${relative(file)} -> ${reference}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);

  const rootManifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  for (const packageName of ["@threejson/scene-agent-kit", "@threejson/react-scene-agent"]) {
    assert.equal(rootManifest.dependencies?.[packageName], undefined);
    assert.equal(rootManifest.peerDependencies?.[packageName], undefined);
  }
});

test("packages do not statically import aggregate ThreeJSON entries", () => {
  const violations = [];
  const staticImportPattern =
    /(?:^|[;\n])\s*(?:import|export)\s+(?:type\s+)?(?:[^"'();]*?\s+from\s*)?["']([^"']+)["']/gm;
  for (const file of walkFiles(path.join(REPO_ROOT, "packages"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(staticImportPattern)) {
      if (match[1] === "threejson" || match[1] === "threejson/core") {
        violations.push(`${relative(file)} -> ${match[1]}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("optional dynamic-runtime stores are not created by every RuntimeContext", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, "core", "runtime", "runtimeContext.js"), "utf8");
  assert.doesNotMatch(source, /from\s+["']\.\/runtimeEntityRegistry\.js["']/);
  assert.doesNotMatch(source, /from\s+["']\.\/frameCommitScheduler\.js["']/);
  assert.doesNotMatch(source, /ctx\.(?:entityRegistry|frameCommitScheduler)\s*=/);
});

test("domains never import host tools", () => {
  const toolsRoot = path.join(REPO_ROOT, "tools") + path.sep;
  const violations = [];
  for (const file of walkFiles(path.join(REPO_ROOT, "domains"))) {
    for (const reference of collectModuleReferences(file)) {
      const resolved = resolveLocalReference(file, reference);
      if (resolved?.startsWith(toolsRoot)) violations.push(`${relative(file)} -> ${reference}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("scene-host apps do not import another app's internals", () => {
  const sceneHostRoot = path.join(REPO_ROOT, "tools", "scene-host");
  const violations = [];
  for (const app of SCENE_HOST_APPS) {
    for (const file of walkFiles(path.join(sceneHostRoot, app))) {
      for (const reference of collectModuleReferences(file)) {
        const resolved = resolveLocalReference(file, reference);
        if (!resolved?.startsWith(sceneHostRoot + path.sep)) continue;
        const targetApp = path.relative(sceneHostRoot, resolved).split(path.sep)[0];
        if (SCENE_HOST_APPS.has(targetApp) && targetApp !== app) {
          violations.push(`${relative(file)} -> ${reference}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("scene-host shared does not import app internals", () => {
  const sceneHostRoot = path.join(REPO_ROOT, "tools", "scene-host");
  const violations = [];
  for (const file of walkFiles(path.join(sceneHostRoot, "shared"))) {
    for (const reference of collectModuleReferences(file)) {
      const resolved = resolveLocalReference(file, reference);
      if (!resolved?.startsWith(sceneHostRoot + path.sep)) continue;
      const targetApp = path.relative(sceneHostRoot, resolved).split(path.sep)[0];
      if (SCENE_HOST_APPS.has(targetApp)) violations.push(`${relative(file)} -> ${reference}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("independent root host apps do not import scene-host shared", () => {
  const violations = [];
  for (const name of ["room-show.html", "port-show.html"]) {
    const file = path.join(REPO_ROOT, name);
    for (const reference of collectModuleReferences(file)) {
      const resolved = resolveLocalReference(file, reference);
      if (resolved?.startsWith(path.join(REPO_ROOT, "tools", "scene-host", "shared") + path.sep)) {
        violations.push(`${name} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("packages/* never reach into core/domains/extensions/tools via relative paths", () => {
  // The whole point of packages/* (e.g. @threejson/host-kit) is to be installable standalone,
  // depending on the *published* threejson/threejson-core/threejson-domains-* surface — never the
  // monorepo's own source tree. A relative import here would silently work in this repo but break
  // for any real consumer who only has node_modules/threejson, not a sibling core/ folder. This is
  // exactly the class of bug found and fixed when packages/host-kit was first extracted.
  const packagesRoot = path.join(REPO_ROOT, "packages");
  if (!fs.existsSync(packagesRoot)) return;
  const forbiddenRoots = ["core", "domains", "extensions", "tools"].map(
    (dir) => path.join(REPO_ROOT, dir) + path.sep
  );
  const violations = [];
  for (const file of walkFiles(packagesRoot)) {
    for (const reference of collectModuleReferences(file)) {
      const resolved = resolveLocalReference(file, reference);
      if (resolved && forbiddenRoots.some((root) => resolved.startsWith(root))) {
        violations.push(`${relative(file)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("apps/* import only via bare package specifiers, never monorepo internals or ThreeBox source", () => {
  // The whole premise of apps/* is that each is a standalone consumer of the *published*
  // @threejson/* packages — exactly what an outside user would `npm install`. So every relative
  // import must stay inside its own app directory; a relative path escaping into core/, domains/,
  // packages/, tools/scene-host (ThreeBox source), or a sibling app would mean the app secretly
  // depends on the monorepo layout and could not be lifted out and published on its own. Cross-
  // package sharing is allowed *only* through bare specifiers (@threejson/*, threejson, three, …),
  // which resolve through node_modules like a real install.
  const appsRoot = path.join(REPO_ROOT, "apps");
  if (!fs.existsSync(appsRoot)) return;
  const violations = [];
  for (const app of fs.readdirSync(appsRoot, { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    const appRoot = path.join(appsRoot, app.name) + path.sep;
    for (const file of walkFiles(path.join(appsRoot, app.name))) {
      for (const reference of collectModuleReferences(file)) {
        const resolved = resolveLocalReference(file, reference);
        // Only relative references resolve to a path; bare specifiers (packages) are allowed.
        if (resolved && !resolved.startsWith(appRoot)) {
          violations.push(`${relative(file)} -> ${reference}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("apps/* do not import tools/scene-host (ThreeBox source) via any specifier", () => {
  // Belt-and-suspenders alongside the relative-escape check: catch an accidental bare/aliased
  // reference to the original ThreeBox source, which the apps are explicitly forbidden to depend on.
  const appsRoot = path.join(REPO_ROOT, "apps");
  if (!fs.existsSync(appsRoot)) return;
  const violations = [];
  for (const file of walkFiles(appsRoot)) {
    for (const reference of collectModuleReferences(file)) {
      if (/scene-host/.test(reference) || /(^|\/)tools\//.test(reference)) {
        violations.push(`${relative(file)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("legacy tools/scene-host remains deployable without packages/*", () => {
  // The legacy host is the production baseline. Shared behavior may evolve, but it must not start
  // depending on workspace packages until that migration is explicitly completed.
  const packagesRoot = path.join(REPO_ROOT, "packages") + path.sep;
  const sceneHostRoot = path.join(REPO_ROOT, "tools", "scene-host");
  if (!fs.existsSync(sceneHostRoot)) return;
  const violations = [];
  for (const file of walkFiles(sceneHostRoot)) {
    for (const reference of collectModuleReferences(file)) {
      const resolved = resolveLocalReference(file, reference);
      if (resolved?.startsWith(packagesRoot) || /^@threejson\/(?!assets)/.test(reference)) {
        violations.push(`${relative(file)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

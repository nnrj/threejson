/**
 * Make standalone HTML tutorial demos work from both a site root and a
 * GitHub Pages project subpath.
 *
 * Run from repo root:
 *   node tools/dev/fix-html-demo-pages-base-paths.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DEMO_ROOT = path.join(ROOT, "examples", "html-demo");
const PAGE_ROOT = "../../../";

function walkHtmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtmlFiles(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      out.push(fullPath);
    }
  }
  return out;
}

const replacements = [
  [/href="\/assets\/img\/threejson\.ico"/g, `href="${PAGE_ROOT}assets/img/threejson.ico"`],
  [/"threejson":\s*"\/builtins\/full\.js"/g, `"threejson": "${PAGE_ROOT}builtins/full.js"`],
  [/"threejson\/core":\s*"\/core\/index\.js"/g, `"threejson/core": "${PAGE_ROOT}core/index.js"`],
  [/assetsBase:\s*"\/assets"/g, `assetsBase: "${PAGE_ROOT}assets"`],
  [/const sceneJsonUrl = "\/assets\//g, `const sceneJsonUrl = "${PAGE_ROOT}assets/`],
  [/fetch\("\/assets\//g, `fetch("${PAGE_ROOT}assets/`],
  [/import\("\/tools\//g, `import("${PAGE_ROOT}tools/`],
  [/import\("\/core\//g, `import("${PAGE_ROOT}core/`],
  [/import\("\/extensions\//g, `import("${PAGE_ROOT}extensions/`],
  [/<code>\/assets\//g, `<code>${PAGE_ROOT}assets/`]
];

let changed = 0;
for (const filePath of walkHtmlFiles(DEMO_ROOT)) {
  const before = fs.readFileSync(filePath, "utf8");
  let after = before;
  for (const [pattern, replacement] of replacements) {
    after = after.replace(pattern, replacement);
  }
  if (after !== before) {
    fs.writeFileSync(filePath, after, "utf8");
    changed += 1;
  }
}

console.log(`Updated ${changed} HTML demo file(s).`);

/**
 * Verify html-demo UTF-8 vs temp_old and scan for replacement chars.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "temp_old/examples/html-demo");
const DST = path.join(ROOT, "examples/html-demo");

function stripAssetsBase(text) {
  return text
    .replace(/assetsBase:\s*"\/assets",?\s*/g, "")
    .replace(/,\s*assetsBase:\s*"\/assets"/g, "")
    .replace(/\{\s*canvas,\s*assetsBase:\s*"\/assets"\s*\}/g, "{ canvas }")
    .replace(/\n\s*assetsBase:\s*"\/assets",?\n/g, "\n");
}

function walkHtml(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      walkHtml(full, out);
    } else if (name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}

const skipDirs = new Set(["temp_old", "node_modules", ".git"]);
function scanFffd(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) scanFffd(full, out);
    else if (/\.(html|js|mjs|md|json|css)$/.test(name)) {
      const text = fs.readFileSync(full, "utf8");
      if (text.includes("\uFFFD")) out.push(path.relative(ROOT, full));
    }
  }
  return out;
}

let matched = 0;
let diff = 0;
const diffs = [];
for (const src of walkHtml(SRC)) {
  const rel = path.relative(SRC, src);
  const dst = path.join(DST, rel);
  if (!fs.existsSync(dst)) {
    diffs.push({ rel, reason: "missing in examples" });
    diff++;
    continue;
  }
  const a = stripAssetsBase(fs.readFileSync(src, "utf8"));
  const b = stripAssetsBase(fs.readFileSync(dst, "utf8"));
  if (a === b) matched++;
  else {
    diff++;
    diffs.push({ rel, reason: "content differs" });
  }
}

const fffd = scanFffd(ROOT);
console.log(`temp_old compare: ${matched} matched, ${diff} differ`);
if (diffs.length) {
  for (const d of diffs.slice(0, 20)) {
    console.log(`  - ${d.rel}: ${d.reason}`);
  }
}
console.log(`project FFFD files: ${fffd.length}`);
for (const f of fffd) console.log(`  - ${f}`);

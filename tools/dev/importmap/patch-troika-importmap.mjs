/**
 * Add troika-three-text to HTML importmaps (line insert, preserves formatting).
 * Only patches pages that may load SDF text; does not add fflate (often already present).
 * Run: node tools/dev/importmap/patch-troika-importmap.mjs
 * Strip from pages without SDF text: node tools/dev/importmap/strip-troika-importmap.mjs
 */
import fs from "fs";
import path from "path";

const TROIKA_VER = "0.52.4";
const THREE_VER = "0.184.0";
const TROIKA_LINE = `        "troika-three-text": "https://esm.sh/troika-three-text@${TROIKA_VER}?deps=three@${THREE_VER}"`;

const PATCH_PATH_RE =
  /track-07-text[/\\]|scene-editor\.html$|scene-player\.html$/i;

function walkHtml(dir, out = []) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, n.name);
    if (n.isDirectory()) {
      if (n.name === "node_modules" || n.name === ".git") continue;
      walkHtml(f, out);
    } else if (n.name.endsWith(".html")) {
      out.push(f);
    }
  }
  return out;
}

/**
 * @param {string} inner
 * @returns {string|null}
 */
function insertTroikaLine(inner) {
  if (inner.includes("troika-three-text")) {
    return null;
  }
  if (!inner.includes('"imports"')) {
    return null;
  }
  const lines = inner.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*}\s*$/.test(lines[i])) {
      const prev = lines[i - 1];
      if (prev && !/,\s*$/.test(prev) && /"\s*:\s*"/.test(prev)) {
        lines[i - 1] = `${prev},`;
      }
      lines.splice(i, 0, TROIKA_LINE);
      return lines.join("\n");
    }
  }
  return null;
}

const re = /<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi;
const root = process.cwd();
let count = 0;

for (const file of walkHtml(root)) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (!PATCH_PATH_RE.test(rel)) {
    continue;
  }
  let html = fs.readFileSync(file, "utf8");
  let fileChanged = false;
  html = html.replace(re, (full, inner) => {
    const patched = insertTroikaLine(inner);
    if (!patched) {
      return full;
    }
    fileChanged = true;
    return full.replace(inner, patched);
  });
  if (fileChanged) {
    fs.writeFileSync(file, html, "utf8");
    count += 1;
    console.log("patched", rel);
  }
}

console.log(`done: ${count} html files`);

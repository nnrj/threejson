/**
 * Remove troika-three-text from importmaps on pages that do not need SDF text.
 * Preserves original whitespace (line-based edit, no JSON reformat).
 * Keeps: track-07-text/, scene-editor.html, scene-player.html
 * Does NOT remove fflate (may be used independently of troika).
 * Run: node tools/dev/importmap/strip-troika-importmap.mjs
 */
import fs from "fs";
import path from "path";

const KEEP_PATH_RE =
  /track-07-text[/\\]|scene-editor\.html$|scene-player\.html$/i;

const TROIKA_LINE = /^\s*"troika-three-text"\s*:\s*"[^"]*"\s*,?\s*$/;

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
 * @param {string} inner importmap script body
 * @returns {string|null}
 */
function stripTroikaLines(inner) {
  if (!inner.includes("troika-three-text")) {
    return null;
  }
  const lines = inner.split("\n");
  const next = lines.filter((line) => !TROIKA_LINE.test(line));
  if (next.length === lines.length) {
    return null;
  }
  // Drop trailing comma on the line before a closing brace when troika was last entry.
  for (let i = 0; i < next.length; i++) {
    const line = next[i];
    if (/^\s*}\s*$/.test(line) || /^\s*}\s*,?\s*$/.test(line)) {
      const prev = next[i - 1];
      if (prev && /,\s*$/.test(prev)) {
        next[i - 1] = prev.replace(/,\s*$/, "");
      }
      break;
    }
  }
  return next.join("\n");
}

const re = /<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi;
const root = process.cwd();
let count = 0;

for (const file of walkHtml(root)) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (KEEP_PATH_RE.test(rel)) {
    continue;
  }
  let html = fs.readFileSync(file, "utf8");
  if (!html.includes("troika-three-text")) {
    continue;
  }
  let fileChanged = false;
  html = html.replace(re, (full, inner) => {
    const stripped = stripTroikaLines(inner);
    if (!stripped) {
      return full;
    }
    fileChanged = true;
    return full.replace(inner, stripped);
  });
  if (fileChanged) {
    fs.writeFileSync(file, html, "utf8");
    count += 1;
    console.log("stripped", rel);
  }
}

console.log(`done: ${count} html files`);

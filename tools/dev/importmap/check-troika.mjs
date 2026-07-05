/**
 * Verify core scene path does not statically import troika-three-text.
 * Run: node tools/dev/importmap/check-troika.mjs
 */
import fs from "fs";
import path from "path";

const re = /<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi;

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

function needsTroikaInMap(html) {
  return (
    html.includes("createJsonScene") ||
    html.includes("core/index.js") ||
    html.includes("builtins/full.js") ||
    html.includes('"threejson"')
  );
}

const KEEP_PATH_RE =
  /track-07-text[/\\]|scene-editor\.html$|scene-player\.html$/i;

const unexpectedTroika = [];
for (const file of walkHtml(process.cwd())) {
  const html = fs.readFileSync(file, "utf8");
  if (!needsTroikaInMap(html)) continue;
  const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
  if (KEEP_PATH_RE.test(rel)) continue;
  if (html.includes("troika-three-text")) {
    unexpectedTroika.push(rel);
  }
}

console.log("HTML with threejson but troika (should be 0 after strip):", unexpectedTroika.length);
unexpectedTroika.forEach((f) => console.log(" ", f));

// Static core chain: textBuilder must not import sdfText at top level
const tb = fs.readFileSync("core/builder/textBuilder.js", "utf8");
const staticSdf = /^import\s+.*from\s+["']\.\/text\/sdfText\.js["']/m.test(tb);
console.log("textBuilder static sdfText import:", staticSdf ? "FAIL" : "ok");

const slh = fs.readFileSync("core/handler/sceneLoadHandler.js", "utf8");
const staticTroika = /from\s+["']troika-three-text["']/.test(slh);
console.log("sceneLoadHandler static troika:", staticTroika ? "FAIL" : "ok");

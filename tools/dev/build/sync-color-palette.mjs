/**
 * One-off: sync demo/tutorial JSON colors & stat/cabinet opacity to Phase 2 palette.
 * Usage: node tools/dev/build/sync-color-palette.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");

const COLOR_MAP = [
  [/#80c342/gi, "#78B83E"],
  [/#e74134/gi, "#DC3A2E"],
  [/#fbbc05/gi, "#E6A800"],
  [/#ea4335/gi, "#DC3A2F"],
  [/#c75450/gi, "#C04A46"],
  [/#4a4b46/gi, "#484942"],
  [/#313335/gi, "#2F3133"],
  [/#d2d3cb/gi, "#D0D1C9"],
  [/#2b2b2b/gi, "#292929"],
  [/#ed6154/gi, "#EB5A4E"],
  [/#00ffff/gi, "#1AD4D4"],
  [/#ffff00/gi, "#E6D400"],
  [/#ff0000/gi, "#DC2800"],
  [/#f0a732/gi, "#DE982F"],
  [/#F0A732/g, "#E59520"]
];

const ROOTS = ["assets/json", "examples"];

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(p, files);
    } else if (ent.name.endsWith(".json")) {
      files.push(p);
    }
  }
  return files;
}

let changed = 0;
for (const rel of ROOTS) {
  const dir = path.join(ROOT, rel);
  if (!fs.existsSync(dir)) {
    continue;
  }
  for (const file of walk(dir)) {
    let text = fs.readFileSync(file, "utf8");
    const orig = text;
    for (const [re, rep] of COLOR_MAP) {
      text = text.replace(re, rep);
    }
    text = text.replace(/("opacity":\s*)0\.88(\s*,)/g, "$10.85$2");
    text = text.replace(/("opacity":\s*)0\.92(\s*,)/g, "$10.85$2");
    if (text !== orig) {
      fs.writeFileSync(file, text);
      changed += 1;
      console.log("updated", path.relative(ROOT, file));
    }
  }
}
console.log("files changed:", changed);

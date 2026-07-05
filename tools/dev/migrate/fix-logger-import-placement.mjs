/**
 * Fix log import lines inserted inside multi-line import blocks.
 * Run: node tools/dev/migrate/fix-logger-import-placement.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../..");
const ROOTS = ["core", "domains", "extensions"].map((d) => join(repoRoot, d));
const BROKEN_RE = /import \{\r?\nimport \{ log \} from "([^"]+)";\r?\n/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else if (name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

let fixed = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative(repoRoot, file).replace(/\\/g, "/");
    if (rel === "core/util/logger.js") {
      continue;
    }
    let text = readFileSync(file, "utf8");
    if (!BROKEN_RE.test(text)) {
      continue;
    }
    BROKEN_RE.lastIndex = 0;
    text = text.replace(BROKEN_RE, 'import { log } from "$1";\nimport {\n');
    writeFileSync(file, text, "utf8");
    fixed += 1;
    console.log("fixed", rel);
  }
}
console.log(`done: ${fixed} file(s)`);

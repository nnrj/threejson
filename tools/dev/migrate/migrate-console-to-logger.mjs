/**
 * Migrate bare console.* in core/domains/extensions to log.* from core/util/logger.js.
 * Run: node tools/dev/migrate/migrate-console-to-logger.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../..");
const LOGGER_ABS = join(repoRoot, "core/util/logger.js");
const LOGGER_REL = "core/util/logger.js";

const ROOTS = ["core", "domains", "extensions"].map((d) => join(repoRoot, d));
const CONSOLE_RE = /\bconsole\.(log|warn|error|debug|info)\b/g;

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

function loggerImportPath(filePath) {
  const utilDir = dirname(LOGGER_ABS);
  let rel = relative(dirname(filePath), utilDir).replace(/\\/g, "/");
  if (rel === "") {
    rel = ".";
  }
  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }
  return `${rel}/logger.js`;
}

function hasLogImport(text) {
  return /\bimport\s*\{[^}]*\blog\b[^}]*\}\s*from\s*['"][^'"]*logger\.js['"]/.test(text);
}

function insertLogImport(text, importPath) {
  const importLine = `import { log } from "${importPath}";\n`;
  if (hasLogImport(text)) {
    return text;
  }
  const shebang = text.startsWith("#!") ? text.match(/^#!.*\n/)?.[0] ?? "" : "";
  const body = shebang ? text.slice(shebang.length) : text;
  const importBlock = body.match(/^(?:\/\*\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*(?:import\s[^\n]+\n)+/);
  if (importBlock) {
    const end = importBlock[0].length;
    return shebang + body.slice(0, end) + importLine + body.slice(end);
  }
  return shebang + importLine + body;
}

let changed = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative(repoRoot, file).replace(/\\/g, "/");
    if (rel === LOGGER_REL) {
      continue;
    }
    let text = readFileSync(file, "utf8");
    if (!CONSOLE_RE.test(text)) {
      continue;
    }
    CONSOLE_RE.lastIndex = 0;
    text = text.replace(/\bconsole\.warn\b/g, "log.warn");
    text = text.replace(/\bconsole\.error\b/g, "log.error");
    text = text.replace(/\bconsole\.debug\b/g, "log.debug");
    text = text.replace(/\bconsole\.info\b/g, "log.info");
    text = text.replace(/\bconsole\.log\b/g, "log.debug");
    if (!hasLogImport(text)) {
      text = insertLogImport(text, loggerImportPath(file));
    }
    writeFileSync(file, text, "utf8");
    changed += 1;
    console.log("migrated", rel);
  }
}

console.log(`done: ${changed} file(s)`);

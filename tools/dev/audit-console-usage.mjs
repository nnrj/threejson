/**
 * Summarize console.* vs log.* in runtime packages (core, domains, extensions).
 * Gate mode: exit 1 if any bare console.* remains outside core/util/logger.js.
 *
 * Run: node tools/dev/audit-console-usage.mjs
 *      node tools/dev/audit-console-usage.mjs --gate
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const gate = process.argv.includes("--gate");

const ROOTS = ["core", "domains", "extensions"].map((d) => join(repoRoot, d));
const CONSOLE_RE = /\bconsole\.(log|warn|error|debug|info)\s*\(/g;
const LOG_RE = /\blog\.(log|warn|error|debug|info)\s*\(/g;
const LOGGER_REL = "core/util/logger.js";

function normalizeRel(p) {
  return relative(repoRoot, p).replace(/\\/g, "/");
}

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

/** @type {Map<string, { console: number, log: number, files: string[] }>} */
const byRoot = new Map();
let violations = [];

for (const root of ROOTS) {
  const label = relative(repoRoot, root);
  byRoot.set(label, { console: 0, log: 0, files: [] });
  for (const file of walk(root)) {
    const rel = normalizeRel(file);
    if (rel === LOGGER_REL) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    const consoleCount = [...text.matchAll(CONSOLE_RE)].length;
    const logCount = [...text.matchAll(LOG_RE)].length;
    if (consoleCount === 0 && logCount === 0) {
      continue;
    }
    const bucket = byRoot.get(label);
    bucket.console += consoleCount;
    bucket.log += logCount;
    bucket.files.push(`${rel} (console:${consoleCount} log:${logCount})`);
    if (consoleCount > 0) {
      violations.push(rel);
    }
  }
}

console.log("Runtime console / logger usage:\n");
for (const [label, stats] of byRoot) {
  if (stats.console === 0 && stats.log === 0) {
    continue;
  }
  console.log(`[${label}] console.*: ${stats.console}, log.*: ${stats.log}`);
  for (const line of stats.files.sort()) {
    console.log(`  ${line}`);
  }
  console.log("");
}

const totalConsole = [...byRoot.values()].reduce((n, s) => n + s.console, 0);
console.log(`Total bare console.* (excl. logger.js): ${totalConsole}`);

if (gate) {
  if (violations.length > 0) {
    console.error(`lint:console FAIL — ${violations.length} file(s) still use console.*`);
    process.exit(1);
  }
  console.log("lint:console OK");
}

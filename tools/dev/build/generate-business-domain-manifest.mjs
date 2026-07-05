/**
 * Recursively scans domains (nested index.js) and writes builtins/builtinDomainManifest.generated.js.
 * Browser ESM static imports; runtime does not scan directories.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const domainsDir = path.join(repoRoot, "domains");
const outPath = path.join(repoRoot, "builtins", "builtinDomainManifest.generated.js");

/**
 * @param {string[]} segments
 * @returns {string}
 */
function segmentsToImportBinding(segments) {
  let s = segments
    .map((seg) => seg.replace(/[^a-zA-Z0-9_$]/g, "_"))
    .join("_");
  if (/^[0-9]/.test(s)) {
    s = `_${s}`;
  }
  return `${s}Domain`;
}

/**
 * @param {string} dir
 * @param {string[]} parentSegments
 * @returns {{ segments: string[], importPath: string }[]}
 */
function discoverDomainEntries(dir, parentSegments = []) {
  /** @type {{ segments: string[], importPath: string }[]} */
  const out = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const hasIndex = entries.some((e) => e.isFile() && e.name === "index.js");
  if (hasIndex && parentSegments.length > 0) {
    const importPath = `../domains/${parentSegments.join("/")}/index.js`;
    out.push({ segments: [...parentSegments], importPath });
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    out.push(...discoverDomainEntries(path.join(dir, entry.name), [...parentSegments, entry.name]));
  }
  return out;
}

/**
 * @param {string} filePath
 * @returns {string|null}
 */
function readDescriptorId(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const m = text.match(/\bid\s*:\s*["'`]([^"'`]+)["'`]/);
  return m ? m[1].trim() : null;
}

function main() {
  if (!fs.existsSync(domainsDir)) {
    console.error("Missing domains directory:", domainsDir);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const discovered = discoverDomainEntries(domainsDir, []);
  discovered.sort((a, b) => a.segments.join(".").localeCompare(b.segments.join("."), "en"));

  const usedBindings = new Set();
  const lines = [
    "/**",
    " * AUTO-GENERATED — do not edit by hand.",
    " * Regenerate: npm run generate:business-domain-manifest",
    " */",
    ""
  ];

  const bindings = [];
  for (const entry of discovered) {
    const expectedId = entry.segments.join(".");
    const indexPath = path.join(domainsDir, ...entry.segments, "index.js");
    const declaredId = readDescriptorId(indexPath);
    if (declaredId && declaredId !== expectedId) {
      console.warn(
        `[manifest] id/path mismatch: ${entry.segments.join("/")} declares "${declaredId}", expected "${expectedId}"`
      );
    }

    let binding = segmentsToImportBinding(entry.segments);
    let n = 2;
    while (usedBindings.has(binding)) {
      binding = `${segmentsToImportBinding(entry.segments)}_${n}`;
      n += 1;
    }
    usedBindings.add(binding);
    bindings.push({ binding, importPath: entry.importPath });
    lines.push(`import ${binding} from "${entry.importPath}";`);
  }

  lines.push("");
  lines.push(
    "/** @type {import(\"../core/handler/businessDomainRegistry.js\").BusinessDomainDescriptor[]} */"
  );
  lines.push("export const generatedBusinessDomainDescriptors = [");
  for (const { binding } of bindings) {
    lines.push(`  ${binding},`);
  }
  lines.push("];");
  lines.push("");

  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${path.relative(repoRoot, outPath)} (${bindings.length} domain(s)).`);
}

main();

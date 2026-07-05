/**
 * Validate demo.html locale catalog JSON files (zh + en arrays).
 * Usage: node tools/dev/validate-demo-catalog.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CATALOG_DIR = path.join(ROOT, "examples/html-demo");

const STRUCTURAL_KEYS = [
  "id",
  "track",
  "order",
  "path",
  "jsonFiles",
  "jsonPath",
  "prerequisites",
  "status",
  "tags",
  "lab",
  "parentId"
];

function readCatalogArray(filename) {
  const data = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, filename), "utf8"));
  if (!Array.isArray(data)) {
    throw new Error(`${filename} must be a JSON array`);
  }
  return data;
}

function collectIds(entries, out = new Set()) {
  for (const entry of entries) {
    if (entry?.id) {
      out.add(entry.id);
    }
    if (Array.isArray(entry?.steps)) {
      collectIds(entry.steps, out);
    }
  }
  return out;
}

function structuralSnapshot(entry) {
  const snap = {};
  for (const key of STRUCTURAL_KEYS) {
    if (entry[key] !== undefined) {
      snap[key] = entry[key];
    }
  }
  snap.docLinkCount = (entry.docLinks ?? []).length;
  return snap;
}

function validateEntryShape(entry, ctx, errors) {
  if (!entry.id) {
    errors.push(`${ctx}: missing id`);
  }
  if (typeof entry.path !== "string" || !entry.path) {
    errors.push(`${ctx}: missing path`);
  }
  if (!Array.isArray(entry.docLinks)) {
    errors.push(`${ctx}: docLinks must be an array`);
  } else {
    for (let i = 0; i < entry.docLinks.length; i++) {
      const link = entry.docLinks[i];
      if (!link?.href || !link?.label) {
        errors.push(`${ctx}: docLinks[${i}] needs href and label`);
      }
    }
  }
  for (const prereq of entry.prerequisites ?? []) {
    /* checked globally */
  }
  for (let i = 0; i < (entry.steps ?? []).length; i++) {
    validateEntryShape(entry.steps[i], `${ctx}.steps[${i}]`, errors);
  }
}

function compareStructural(zhEntry, enEntry, ctx, errors) {
  const zhSnap = JSON.stringify(structuralSnapshot(zhEntry));
  const enSnap = JSON.stringify(structuralSnapshot(enEntry));
  if (zhSnap !== enSnap) {
    errors.push(`${ctx}: zh/en structural fields differ`);
  }
  const zhSteps = zhEntry.steps ?? [];
  const enSteps = enEntry.steps ?? [];
  if (zhSteps.length !== enSteps.length) {
    errors.push(`${ctx}: steps length zh=${zhSteps.length} en=${enSteps.length}`);
    return;
  }
  for (let i = 0; i < zhSteps.length; i++) {
    compareStructural(zhSteps[i], enSteps[i], `${ctx}.steps[${i}]`, errors);
  }
}

function validatePaths(entry, ctx, warnings) {
  if (typeof entry.path === "string" && entry.path.startsWith("./")) {
    const abs = path.join(ROOT, entry.path.replace(/^\.\//, ""));
    if (!fs.existsSync(abs)) {
      warnings.push(`${ctx}: path not found: ${entry.path}`);
    }
  }
  for (let i = 0; i < (entry.steps ?? []).length; i++) {
    validatePaths(entry.steps[i], `${ctx}.steps[${i}]`, warnings);
  }
}

function main() {
  const zhList = readCatalogArray("demo-catalog.zh.json");
  const enList = readCatalogArray("demo-catalog.en.json");

  const errors = [];
  const warnings = [];

  if (zhList.length !== enList.length) {
    errors.push(
      `top-level count: zh=${zhList.length} en=${enList.length}`
    );
  }

  const allIds = collectIds(zhList);
  const len = Math.min(zhList.length, enList.length);

  for (let i = 0; i < len; i++) {
    const zh = zhList[i];
    const en = enList[i];
    const ctx = `entry[${i}] ${zh.id ?? "?"}`;
    if (zh.id !== en.id) {
      errors.push(`${ctx}: id mismatch zh=${zh.id} en=${en.id}`);
    }
    validateEntryShape(zh, `${ctx} [zh]`, errors);
    validateEntryShape(en, `${ctx} [en]`, errors);
    compareStructural(zh, en, ctx, errors);
    validatePaths(zh, ctx, warnings);

    for (const prereq of zh.prerequisites ?? []) {
      if (!allIds.has(prereq)) {
        errors.push(`${ctx}: unknown prerequisite "${prereq}"`);
      }
    }
  }

  if (warnings.length) {
    console.warn("[validate-demo-catalog] warnings:");
    for (const w of warnings) {
      console.warn("  -", w);
    }
  }

  if (errors.length) {
    console.error("[validate-demo-catalog] failed:");
    for (const e of errors) {
      console.error("  -", e);
    }
    process.exit(1);
  }

  console.log(
    `[validate-demo-catalog] OK — ${zhList.length} top-level entries, ${allIds.size} ids (incl. steps).`
  );
}

main();

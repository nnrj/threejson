#!/usr/bin/env node
/**
 * ThreeJSON CLI — third-party domain install helper (dev scaffold; no npm publish in this milestone).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = "threejson.domains.mjs";
const BOOTSTRAP = "threejson.bootstrap.mjs";

function usage() {
  console.log(`Usage:
  threejson add-domain <package> [--save-dev]
  threejson list-domains
  threejson generate subdomain <parent-path> <leaf> [--namespace-only] [--force]

Writes ${MANIFEST} in the current working directory (add-domain).
Subdomain scaffold runs in the ThreeJSON repo (domains/ tree).`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveDomainEntry(packageName) {
  const pkgDir = path.join(process.cwd(), "node_modules", packageName);
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    return null;
  }
  const pkg = readJson(pkgJsonPath);
  const tj = pkg.threejson;
  if (tj && typeof tj.domain === "string" && tj.domain.trim()) {
    return { importPath: packageName, domainId: tj.domainId || pkg.name };
  }
  if (pkg.exports && typeof pkg.exports === "object" && pkg.exports["."]) {
    return { importPath: packageName, domainId: pkg.name };
  }
  return { importPath: packageName, domainId: pkg.name };
}

function loadManifest(cwd) {
  const filePath = path.join(cwd, MANIFEST);
  if (!fs.existsSync(filePath)) {
    return { filePath, entries: [] };
  }
  const text = fs.readFileSync(filePath, "utf8");
  const entries = [];
  const re = /import\s+(\w+)\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    entries.push({ binding: m[1], importPath: m[2] });
  }
  return { filePath, entries };
}

function writeManifest(filePath, entries) {
  const lines = [
    "/**",
    " * User-registered ThreeJSON domains. Import before your app uses businessDomains:",
    " *   import './threejson.domains.mjs';",
    " *   import 'threejson/builtins/register';",
    " */",
    "import { registerDomain } from 'threejson/core';",
    ""
  ];
  const used = new Set();
  for (const e of entries) {
    let binding = e.binding;
    if (!binding) {
      binding = e.importPath.replace(/[^a-zA-Z0-9_$]/g, "_").replace(/^(\d)/, "_$1");
      let n = 2;
      while (used.has(binding)) {
        binding = `${binding}_${n}`;
        n += 1;
      }
    }
    used.add(binding);
    lines.push(`import ${binding} from "${e.importPath}";`);
    lines.push(`registerDomain(${binding});`);
    lines.push("");
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function writeBootstrap(cwd) {
  const filePath = path.join(cwd, BOOTSTRAP);
  const lines = [
    "/**",
    " * ThreeJSON app bootstrap: built-in domains + user threejson.domains.mjs",
    " * Import this once before using businessDomains or domain-driven scenes.",
    " */",
    'import "threejson/builtins/register";',
    'import "./threejson.domains.mjs";',
    ""
  ];
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf8");
    if (existing.includes("threejson/builtins/register") && existing.includes(MANIFEST)) {
      return;
    }
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function cmdAddDomain(args) {
  const saveDev = args.includes("--save-dev");
  const pkg = args.find((a) => a && !a.startsWith("-"));
  if (!pkg) {
    console.error("Missing package name.");
    usage();
    process.exit(1);
  }
  const npmArgs = ["install", pkg];
  if (saveDev) {
    npmArgs.push("--save-dev");
  }
  const install = spawnSync("npm", npmArgs, { stdio: "inherit", cwd: process.cwd(), shell: true });
  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
  const entry = resolveDomainEntry(pkg);
  if (!entry) {
    console.error("Could not resolve package after install:", pkg);
    process.exit(1);
  }
  const { filePath, entries } = loadManifest(process.cwd());
  if (!entries.some((e) => e.importPath === entry.importPath)) {
    entries.push({ binding: "", importPath: entry.importPath });
  }
  writeManifest(filePath, entries);
  writeBootstrap(process.cwd());
  console.log(`Updated ${MANIFEST} with domain from ${pkg} (${entry.domainId}).`);
  console.log(`Updated or created ${BOOTSTRAP}.`);
  console.log(`Add to your app entry: import "./${BOOTSTRAP}";`);
}

function cmdListDomains() {
  const { filePath, entries } = loadManifest(process.cwd());
  if (!entries.length) {
    console.log(`No entries in ${filePath} (file may not exist).`);
    return;
  }
  for (const e of entries) {
    console.log(e.importPath);
  }
}

function cmdGenerateSubdomain(args) {
  if (args[0] !== "subdomain") {
    console.error("Usage: threejson generate subdomain <parent-path> <leaf> [options]");
    process.exit(1);
  }
  const repoRoot = path.resolve(__dirname, "../..");
  const script = path.join(repoRoot, "tools/dev/build/generate-subdomain.mjs");
  const child = spawnSync("node", [script, ...args.slice(1)], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false
  });
  process.exit(child.status ?? 1);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
if (!cmd || cmd === "--help" || cmd === "-h") {
  usage();
  process.exit(0);
}
if (cmd === "add-domain") {
  cmdAddDomain(argv.slice(1));
} else if (cmd === "list-domains") {
  cmdListDomains();
} else if (cmd === "generate") {
  cmdGenerateSubdomain(argv.slice(1));
} else {
  console.error("Unknown command:", cmd);
  usage();
  process.exit(1);
}

/**
 * Scaffold a nested business subdomain under domains/.
 *
 * Usage:
 *   node tools/dev/build/generate-subdomain.mjs <parent-path> <leaf> [options]
 *
 * Examples:
 *   node tools/dev/build/generate-subdomain.mjs weather snow
 *   node tools/dev/build/generate-subdomain.mjs weather/particle rain --namespace-only
 *
 * Options:
 *   --namespace-only   Pure namespace descriptor (no create/deploy api)
 *   --factory <rel>    Factory module import relative to generated index.js
 *   --force            Overwrite existing index.js
 *   --dry-run          Print files without writing
 *   --no-manifest      Skip npm run generate:business-domain-manifest
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const domainsDir = path.join(repoRoot, "domains");

const SEGMENT_RE = /^[a-z][a-zA-Z0-9]*$/;

/**
 * @param {string} value
 * @returns {string}
 */
function toPascalCase(value) {
  return String(value || "")
    .replace(/(^|[-_\s]+)([a-zA-Z0-9])/g, (_m, _sep, ch) => ch.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * @param {string[]} segments
 */
function assertValidSegments(segments, label) {
  for (let i = 0; i < segments.length; i += 1) {
    if (!SEGMENT_RE.test(segments[i])) {
      throw new Error(`[generate-subdomain] invalid ${label} segment "${segments[i]}" (use camelCase)`);
    }
  }
}

/**
 * @param {string} parentPath
 * @param {string} leaf
 * @param {string} [factoryRel]
 * @returns {string}
 */
function defaultFactoryImport(parentPath, leaf, factoryRel) {
  if (factoryRel) {
    return factoryRel;
  }
  const parentSegments = parentPath.split("/").filter(Boolean);
  const root = parentSegments[0] || leaf;
  const depth = parentSegments.length;
  return `${"../".repeat(depth)}${root}Factory.js`;
}

/**
 * @param {object} opts
 * @returns {string}
 */
function renderDeployableIndex(opts) {
  const {
    qualifiedId,
    capLeaf,
    leaf,
    parentQualified,
    factoryImport,
    parentPath
  } = opts;
  const peerLine = parentQualified
    ? `  peerDomains: ["${parentQualified}"],\n`
    : "";
  return `import {
  create${capLeaf},
  create${capLeaf}Json,
  deploy${capLeaf}
} from "${factoryImport}";

function resolve${capLeaf}DomainModel(record, scene, ctx) {
  void deploy${capLeaf}(record, scene, ctx);
}

/**
 * Subdomain \`${qualifiedId}\` (generated scaffold — wire factory imports).
 */
const ${toPascalCase(parentPath.split("/").pop() || leaf)}${capLeaf}Domain = {
  id: "${qualifiedId}",
  defaultHandler: "${leaf}",
${peerLine}  resolveDomainModel: resolve${capLeaf}DomainModel,
  api: {
    create${capLeaf}Json,
    create${capLeaf},
    deploy${capLeaf}
  }
};

export default ${toPascalCase(parentPath.split("/").pop() || leaf)}${capLeaf}Domain;
`;
}

/**
 * @param {object} opts
 * @returns {string}
 */
function renderNamespaceIndex(opts) {
  const { qualifiedId, parentQualified } = opts;
  const peerLine = parentQualified
    ? `  peerDomains: ["${parentQualified}"],\n`
    : "";
  const binding = toPascalCase(qualifiedId.replace(/\./g, "_"));

  return `/**
 * Namespace-only subdomain \`${qualifiedId}\` (no deploy api).
 */
const ${binding}Domain = {
  id: "${qualifiedId}",
${peerLine}  api: {}
};

export default ${binding}Domain;
`;
}

/**
 * @param {string} factoryPath
 * @returns {string}
 */
function renderFactoryStub(leaf) {
  const capLeaf = toPascalCase(leaf);
  return `/**
 * Factory stub for subdomain leaf "${leaf}". Replace with real builder logic.
 */

/**
 * @param {object} [overrides]
 * @returns {object}
 */
export function create${capLeaf}Json(overrides = {}) {
  return {
    name: "${leaf}-placeholder",
    objType: "box",
    geometry: { width: 10, height: 10, depth: 10 },
    ...overrides
  };
}

/**
 * @param {object} [overrides]
 * @returns {object}
 */
export function create${capLeaf}(overrides = {}) {
  return create${capLeaf}Json(overrides);
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 * @param {object} [ctx]
 */
export function deploy${capLeaf}(record, scene, ctx) {
  console.warn("[${leaf}] deploy${capLeaf} stub — implement factory + builder");
}
`;
}

/**
 * @param {string[]} argv
 */
export function runGenerateSubdomain(argv) {
  const flags = new Set();
  /** @type {Record<string, string>} */
  const options = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--namespace-only") {
      flags.add("namespace-only");
    } else if (arg === "--force") {
      flags.add("force");
    } else if (arg === "--dry-run") {
      flags.add("dry-run");
    } else if (arg === "--no-manifest") {
      flags.add("no-manifest");
    } else if (arg === "--factory") {
      options.factory = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new Error(`[generate-subdomain] unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length < 2) {
    throw new Error(
      "[generate-subdomain] usage: <parent-path> <leaf> [--namespace-only] [--factory <rel>] [--force] [--dry-run]"
    );
  }

  const parentPath = positional[0].replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const leaf = positional[1].replace(/\\/g, "/").split("/").pop() || "";
  const parentSegments = parentPath.split("/").filter(Boolean);
  const allSegments = [...parentSegments, leaf];
  assertValidSegments(parentSegments, "parent");
  assertValidSegments([leaf], "leaf");

  const qualifiedId = allSegments.join(".");
  const parentQualified = parentSegments.length > 0 ? parentSegments.join(".") : null;
  const capLeaf = toPascalCase(leaf);
  const subdomainDir = path.join(domainsDir, ...parentSegments, leaf);
  const indexPath = path.join(subdomainDir, "index.js");
  const namespaceOnly = flags.has("namespace-only");

  if (fs.existsSync(indexPath) && !flags.has("force")) {
    throw new Error(`[generate-subdomain] already exists: ${path.relative(repoRoot, indexPath)} (use --force)`);
  }

  const parentDomainDir = path.join(domainsDir, ...parentSegments);
  if (!fs.existsSync(parentDomainDir)) {
    throw new Error(
      `[generate-subdomain] parent directory missing: ${path.relative(repoRoot, parentDomainDir)}`
    );
  }

  const factoryImport = defaultFactoryImport(parentPath, leaf, options.factory);
  const indexContent = namespaceOnly
    ? renderNamespaceIndex({ qualifiedId, parentQualified })
    : renderDeployableIndex({
        qualifiedId,
        capLeaf,
        leaf,
        parentQualified,
        factoryImport,
        parentPath
      });

  /** @type {{ path: string, content: string }[]} */
  const files = [{ path: indexPath, content: indexContent }];

  if (!namespaceOnly) {
    const factoryAbs = path.resolve(subdomainDir, factoryImport);
    const rootFactory = path.join(domainsDir, ...parentSegments.slice(0, 1), `${parentSegments[0]}Factory.js`);
    if (!fs.existsSync(factoryAbs) && !fs.existsSync(rootFactory)) {
      const stubPath = path.join(subdomainDir, `${leaf}Factory.js`);
      files.push({ path: stubPath, content: renderFactoryStub(leaf) });
    }
  }

  if (flags.has("dry-run")) {
    for (const file of files) {
      console.log("---", path.relative(repoRoot, file.path));
      console.log(file.content);
    }
    return { qualifiedId, files: files.map((f) => f.path), dryRun: true };
  }

  fs.mkdirSync(subdomainDir, { recursive: true });
  for (const file of files) {
    if (fs.existsSync(file.path) && !flags.has("force") && file.path !== indexPath) {
      continue;
    }
    fs.writeFileSync(file.path, file.content, "utf8");
    console.log("Wrote", path.relative(repoRoot, file.path));
  }

  if (!flags.has("no-manifest")) {
    const manifest = spawnSync("npm", ["run", "generate:business-domain-manifest"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: true
    });
    if (manifest.status !== 0) {
      throw new Error("[generate-subdomain] generate:business-domain-manifest failed");
    }
  }

  console.log(`Subdomain scaffold ready: id="${qualifiedId}"`);
  if (!namespaceOnly) {
    console.log(`Implement api.create${capLeaf} / deploy${capLeaf} in factory, then npm test.`);
  }

  return { qualifiedId, files: files.map((f) => f.path), dryRun: false };
}

function main() {
  try {
    runGenerateSubdomain(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const PACKAGE_PLAN = Object.freeze([
  { key: "assets", name: "@threejson/assets", dir: "assets", versionGroup: "assets" },
  { key: "threejson", name: "threejson", dir: ".", versionGroup: "threejson" },
  { key: "host-kit", name: "@threejson/host-kit", dir: "packages/host-kit", versionGroup: "packages" },
  { key: "editor-kit", name: "@threejson/editor-kit", dir: "packages/editor-kit", versionGroup: "packages" },
  { key: "player-kit", name: "@threejson/player-kit", dir: "packages/player-kit", versionGroup: "packages" },
  { key: "scene-agent-kit", name: "@threejson/scene-agent-kit", dir: "packages/scene-agent-kit", versionGroup: "packages" },
  { key: "react", name: "@threejson/react", dir: "packages/react", versionGroup: "packages" },
  { key: "react-scene-agent", name: "@threejson/react-scene-agent", dir: "packages/react-scene-agent", versionGroup: "packages" },
  { key: "react-ui", name: "@threejson/react-ui", dir: "packages/react-ui", versionGroup: "packages" }
]);

const TEMPLATE_BUILDERS = [
  "tools/scene-host/shared/js/templateExportBuilders.js",
  "packages/host-kit/js/templateExportBuilders.js"
];
const QUICK_START_DOCS = ["docs/en/quick-start.md", "docs/zh/quick-start.md"];
const PACKAGE_BY_NAME = new Map(PACKAGE_PLAN.map((item) => [item.name, item]));
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const REQUIRED_THREEJSON_PACKAGE_FILES = Object.freeze([
  "core/runtime.js",
  "core/ai/index.js",
  "package.json"
]);
const DEFAULT_CDN_TIMEOUT_SECONDS = 180;
const DEFAULT_CDN_POLL_INTERVAL_MS = 5_000;

function absolute(relativePath) {
  return path.resolve(REPO_ROOT, relativePath);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(absolute(relativePath), "utf8"));
}

function writeJson(relativePath, value, dryRun) {
  if (!dryRun) fs.writeFileSync(absolute(relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function replaceFile(relativePath, update, dryRun) {
  const file = absolute(relativePath);
  const before = fs.readFileSync(file, "utf8");
  const after = update(before);
  if (after === before) return false;
  if (!dryRun) fs.writeFileSync(file, after, "utf8");
  return true;
}

function assertVersion(value, label) {
  if (!VERSION_PATTERN.test(value)) throw new Error(`${label} 不是合法的 npm 版本号：${value}`);
  return value;
}

export function nextPrerelease(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)-([0-9A-Za-z.-]*?)(\d+)$/);
  if (match) return `${match[1]}.${match[2]}.${match[3]}-${match[4]}${Number(match[5]) + 1}`;
  const stable = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (stable) return `${stable[1]}.${stable[2]}.${Number(stable[3]) + 1}-alpha.1`;
  throw new Error(`无法自动计算下一个预发布版本：${version}`);
}

export function nextPatch(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`无法自动计算下一个补丁版本：${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith("--") ? args.shift() : "";
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) throw new Error(`无法识别的参数：${token}`);
    const equalsAt = token.indexOf("=");
    if (equalsAt > 2) {
      flags[token.slice(2, equalsAt)] = token.slice(equalsAt + 1);
      continue;
    }
    const key = token.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    encoding: options.capture ? "utf8" : undefined,
    shell: false,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const details = options.capture ? `\n${result.stderr || result.stdout || ""}` : "";
    throw new Error(`${command} ${args.join(" ")} 执行失败（退出码 ${result.status}）。${details}`);
  }
  return result;
}

export function resolveNpmInvocation(args) {
  const npmCliCandidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  ].filter(Boolean);
  const npmCli = npmCliCandidates.find((candidate) => fs.existsSync(candidate));
  if (npmCli) return { command: process.execPath, args: [npmCli, ...args] };
  if (process.platform === "win32") {
    throw new Error("找不到 npm-cli.js；请通过 npm run release 执行发布工具。");
  }
  return { command: "npm", args };
}

function runNpm(args, options = {}) {
  const invocation = resolveNpmInvocation(args);
  return run(invocation.command, invocation.args, options);
}

function runGit(args, options = {}) {
  return run("git", args, options);
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(String(output || "").trim());
  } catch (error) {
    throw new Error(`${label} 未返回合法 JSON：${error?.message || error}`);
  }
}

function normalizePackMetadata(output, label) {
  const parsed = parseJsonOutput(output, label);
  const metadata = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!metadata || typeof metadata !== "object") throw new Error(`${label} 缺少包元数据。`);
  return metadata;
}

function inspectLocalPackage(item) {
  const result = runNpm(["pack", "--dry-run", "--json"], {
    cwd: absolute(item.dir),
    capture: true
  });
  return normalizePackMetadata(result.stdout, `${item.name} npm pack --dry-run`);
}

export function assertThreejsonPackMetadata(metadata) {
  const files = new Set((metadata?.files || []).map((item) => String(item?.path || "").replaceAll("\\", "/")));
  const missing = REQUIRED_THREEJSON_PACKAGE_FILES.filter((entry) => !files.has(entry));
  if (missing.length) {
    throw new Error(`threejson tarball 缺少发布入口：${missing.join(", ")}`);
  }
  return true;
}

export function assertMatchingPackageIntegrity(item, localMetadata, publishedMetadata) {
  const label = `${item.name}@${publishedMetadata?.version || localMetadata?.version || "unknown"}`;
  if (localMetadata?.integrity && publishedMetadata?.integrity) {
    if (localMetadata.integrity !== publishedMetadata.integrity) {
      throw new Error(`${label} 已存在，但 npm 上的内容与本地 tarball 不一致；必须升级版本号，不能使用 --resume。`);
    }
    return true;
  }
  if (localMetadata?.shasum && publishedMetadata?.shasum) {
    if (localMetadata.shasum !== publishedMetadata.shasum) {
      throw new Error(`${label} 已存在，但 npm 上的内容与本地 tarball 不一致；必须升级版本号，不能使用 --resume。`);
    }
    return true;
  }
  throw new Error(`${label} 缺少可比较的 integrity/shasum，无法安全断点续发。`);
}

export function resolveExistingPackageAction(item, publishedMetadata, { resume = false } = {}) {
  if (!publishedMetadata) return "publish";
  if (item.key === "assets") return "reuse-assets";
  return resume ? "resume" : "conflict";
}

export function threejsonRuntimeCdnUrl(version) {
  return `https://cdn.jsdelivr.net/npm/threejson@${assertVersion(String(version), "threejson CDN 版本")}/core/runtime.js`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForThreejsonRuntimeCdn(version, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("当前 Node.js 环境不支持 fetch，无法验证 jsDelivr。");
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_CDN_TIMEOUT_SECONDS * 1000);
  const intervalMs = Number(options.intervalMs ?? DEFAULT_CDN_POLL_INTERVAL_MS);
  const requestTimeoutMs = Number(options.requestTimeoutMs ?? 15_000);
  const sleep = options.sleep || wait;
  const now = options.now || Date.now;
  const onAttempt = options.onAttempt || (() => {});
  const baseUrl = threejsonRuntimeCdnUrl(version);
  const deadline = now() + timeoutMs;
  let attempt = 0;
  let lastFailure = "尚未请求";

  do {
    attempt += 1;
    try {
      const separator = baseUrl.includes("?") ? "&" : "?";
      const response = await fetchImpl(`${baseUrl}${separator}release-check=${now()}`, {
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(requestTimeoutMs)
      });
      const source = response.ok ? await response.text() : "";
      if (response.ok && /\bcreateJsonScene\b/.test(source)) {
        return { ok: true, attempt, status: response.status, url: baseUrl };
      }
      lastFailure = response.ok
        ? "响应中缺少 createJsonScene 导出"
        : `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error?.message || String(error);
    }
    onAttempt({ attempt, lastFailure, url: baseUrl });
    if (now() >= deadline) break;
    await sleep(Math.max(0, Math.min(intervalMs, deadline - now())));
  } while (now() <= deadline);

  throw new Error(`jsDelivr 尚未提供 ${baseUrl}（${lastFailure}）。请稍后使用 --resume 重试发布。`);
}

function currentVersions() {
  const root = readJson("package.json");
  const assets = readJson("assets/package.json");
  const packageVersions = PACKAGE_PLAN
    .filter((item) => item.versionGroup === "packages")
    .map((item) => readJson(`${item.dir}/package.json`).version);
  return {
    threejson: root.version,
    assets: assets.version,
    packages: packageVersions[0],
    packageVersions
  };
}

function updatePeerRanges(manifest, versions) {
  if (!manifest.peerDependencies) return;
  for (const dependencyName of Object.keys(manifest.peerDependencies)) {
    if (dependencyName === "threejson") {
      manifest.peerDependencies[dependencyName] = `^${versions.threejson}`;
    } else if (PACKAGE_BY_NAME.get(dependencyName)?.versionGroup === "packages") {
      manifest.peerDependencies[dependencyName] = `^${versions.packages}`;
    }
  }
}

function updateLockfile(versions, dryRun) {
  const lockPath = absolute("package-lock.json");
  if (!fs.existsSync(lockPath)) return;
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lock.name = "threejson";
  lock.version = versions.threejson;
  if (lock.packages?.[""]) lock.packages[""].version = versions.threejson;
  for (const entry of Object.values(lock.packages || {})) {
    const plan = PACKAGE_BY_NAME.get(entry?.name);
    if (!plan) continue;
    entry.version = versions[plan.versionGroup];
    updatePeerRanges(entry, versions);
  }
  writeJson("package-lock.json", lock, dryRun);
}

function updateQuickStartVersions(versions, dryRun) {
  for (const relativePath of QUICK_START_DOCS) {
    replaceFile(relativePath, (source) => {
      let updated = source.replace(
        /threejson@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g,
        `threejson@${versions.threejson}`
      );
      updated = updated.replace(
        /@threejson\/assets@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g,
        `@threejson/assets@${versions.assets}`
      );
      return updated;
    }, dryRun);
  }
}

export function applyVersions(versions, { dryRun = false } = {}) {
  const previous = currentVersions();
  const normalized = {
    threejson: assertVersion(String(versions.threejson), "threejson 版本"),
    packages: assertVersion(String(versions.packages), "@threejson/* 版本"),
    assets: assertVersion(String(versions.assets), "@threejson/assets 版本")
  };

  const rootManifest = readJson("package.json");
  rootManifest.version = normalized.threejson;
  writeJson("package.json", rootManifest, dryRun);

  for (const item of PACKAGE_PLAN.filter((candidate) => candidate.versionGroup === "packages")) {
    const manifestPath = `${item.dir}/package.json`;
    const manifest = readJson(manifestPath);
    manifest.version = normalized.packages;
    updatePeerRanges(manifest, normalized);
    writeJson(manifestPath, manifest, dryRun);
  }

  const assetsManifest = readJson("assets/package.json");
  assetsManifest.version = normalized.assets;
  writeJson("assets/package.json", assetsManifest, dryRun);

  for (const relativePath of TEMPLATE_BUILDERS) {
    const changed = replaceFile(relativePath, (source) => source.replace(
      /export const TEMPLATE_THREEJSON_VERSION = "[^"]+";/,
      `export const TEMPLATE_THREEJSON_VERSION = "${normalized.threejson}";`
    ), dryRun);
    if (!changed && previous.threejson !== normalized.threejson) {
      throw new Error(`${relativePath} 缺少 TEMPLATE_THREEJSON_VERSION，无法安全同步版本。`);
    }
  }

  const assetsVersionSource = fs.readFileSync(absolute("core/util/assetsBase.js"), "utf8");
  if (!/export const ASSETS_PACKAGE_VERSION = "[^"]+";/.test(assetsVersionSource)) {
    throw new Error("core/util/assetsBase.js 缺少 ASSETS_PACKAGE_VERSION。 ");
  }
  replaceFile("core/util/assetsBase.js", (source) => source.replace(
    /export const ASSETS_PACKAGE_VERSION = "[^"]+";/,
    `export const ASSETS_PACKAGE_VERSION = "${normalized.assets}";`
  ), dryRun);

  updateQuickStartVersions(normalized, dryRun);
  updateLockfile(normalized, dryRun);
  return { previous, versions: normalized, dryRun };
}

export function validateReleaseState() {
  const problems = [];
  const versions = currentVersions();
  for (const [label, version] of Object.entries({
    threejson: versions.threejson,
    assets: versions.assets,
    packages: versions.packages
  })) {
    if (!VERSION_PATTERN.test(String(version))) problems.push(`${label} 版本非法：${version}`);
  }
  if (new Set(versions.packageVersions).size !== 1) {
    problems.push(`@threejson/* 版本不一致：${versions.packageVersions.join(", ")}`);
  }

  for (const item of PACKAGE_PLAN.filter((candidate) => candidate.versionGroup === "packages")) {
    const manifest = readJson(`${item.dir}/package.json`);
    for (const [dependencyName, range] of Object.entries(manifest.peerDependencies || {})) {
      if (dependencyName === "threejson" && range !== `^${versions.threejson}`) {
        problems.push(`${item.name} 的 threejson peer 依赖为 ${range}，应为 ^${versions.threejson}`);
      }
      if (PACKAGE_BY_NAME.get(dependencyName)?.versionGroup === "packages" && range !== `^${versions.packages}`) {
        problems.push(`${item.name} 的 ${dependencyName} peer 依赖为 ${range}，应为 ^${versions.packages}`);
      }
    }
  }

  const builderSources = TEMPLATE_BUILDERS.map((relativePath) => fs.readFileSync(absolute(relativePath), "utf8"));
  if (builderSources[0] !== builderSources[1]) problems.push("templateExportBuilders.js 的工具源与 host-kit 副本不一致。");
  for (const [index, source] of builderSources.entries()) {
    const match = source.match(/export const TEMPLATE_THREEJSON_VERSION = "([^"]+)";/);
    if (match?.[1] !== versions.threejson) {
      problems.push(`${TEMPLATE_BUILDERS[index]} 的 CDN 版本为 ${match?.[1] || "缺失"}，应为 ${versions.threejson}`);
    }
    if (/runtime-compat|threejson\/core|core\/index\.js|falling back/i.test(source)) {
      problems.push(`${TEMPLATE_BUILDERS[index]} 不应包含旧 core 兼容回退。`);
    }
    if (!/import \{ createJsonScene \} from "threejson\/runtime";/.test(source)) {
      problems.push(`${TEMPLATE_BUILDERS[index]} 下载模板未直接导入 threejson/runtime。`);
    }
  }

  const assetsSource = fs.readFileSync(absolute("core/util/assetsBase.js"), "utf8");
  const assetsMatch = assetsSource.match(/export const ASSETS_PACKAGE_VERSION = "([^"]+)";/);
  if (assetsMatch?.[1] !== versions.assets) {
    problems.push(`core/util/assetsBase.js 的 assets 版本为 ${assetsMatch?.[1] || "缺失"}，应为 ${versions.assets}`);
  }

  for (const relativePath of QUICK_START_DOCS) {
    const source = fs.readFileSync(absolute(relativePath), "utf8");
    for (const match of source.matchAll(/threejson@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g)) {
      if (match[1] !== versions.threejson) {
        problems.push(`${relativePath} 引用了 threejson@${match[1]}，应为 ${versions.threejson}`);
      }
    }
    for (const match of source.matchAll(/@threejson\/assets@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g)) {
      if (match[1] !== versions.assets) {
        problems.push(`${relativePath} 引用了 @threejson/assets@${match[1]}，应为 ${versions.assets}`);
      }
    }
  }

  const rootManifest = readJson("package.json");
  for (const [subpath, target] of [["./runtime", "./core/runtime.js"], ["./ai", "./core/ai/index.js"]]) {
    if (rootManifest.exports?.[subpath] !== target) problems.push(`threejson 缺少发布入口 ${subpath} -> ${target}`);
    if (!fs.existsSync(absolute(target.replace(/^\.\//, "")))) problems.push(`threejson 发布入口文件不存在：${target}`);
  }

  return { ok: problems.length === 0, problems, versions };
}

function requireValidReleaseState() {
  const result = validateReleaseState();
  if (!result.ok) throw new Error(`发布状态检查失败：\n- ${result.problems.join("\n- ")}`);
  console.log(`发布状态检查通过：threejson ${result.versions.threejson}，packages ${result.versions.packages}，assets ${result.versions.assets}`);
  return result;
}

async function ask(question, defaultValue = "") {
  if (!process.stdin.isTTY) {
    if (defaultValue) return defaultValue;
    throw new Error(`非交互环境缺少必要参数：${question}`);
  }
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await terminal.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue;
  } finally {
    terminal.close();
  }
}

async function commandVersion(flags = {}) {
  const current = currentVersions();
  const proposedThreejson = String(flags.threejson || await ask("threejson 新版本", nextPrerelease(current.threejson)));
  const proposedPackages = String(flags.packages || await ask("全部 @threejson/* packages 新版本", nextPrerelease(current.packages)));
  const assetsDefault = flags["bump-assets"] ? nextPatch(current.assets) : current.assets;
  const proposedAssets = String(flags.assets || await ask("@threejson/assets 新版本（无资源变化请保持）", assetsDefault));
  const result = applyVersions({
    threejson: proposedThreejson,
    packages: proposedPackages,
    assets: proposedAssets
  }, { dryRun: Boolean(flags["dry-run"]) });
  console.log(`${result.dryRun ? "预览" : "完成"}版本同步：`);
  console.log(`  threejson: ${result.previous.threejson} -> ${result.versions.threejson}`);
  console.log(`  packages: ${result.previous.packages} -> ${result.versions.packages}`);
  console.log(`  assets: ${result.previous.assets} -> ${result.versions.assets}`);
  if (!result.dryRun) requireValidReleaseState();
  return result;
}

function commandTest() {
  requireValidReleaseState();
  runNpm(["run", "validate:demo-catalog"]);
  runNpm(["run", "verify"]);
}

function releaseOutputDirectory() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = absolute(`dist/release/${stamp}`);
  fs.mkdirSync(destination, { recursive: true });
  return destination;
}

function commandPack() {
  requireValidReleaseState();
  runNpm(["run", "generate:business-domain-manifest"]);
  const destination = releaseOutputDirectory();
  for (const item of PACKAGE_PLAN) {
    console.log(`\n打包 ${item.name}`);
    const result = runNpm(["pack", "--json", "--pack-destination", destination], {
      cwd: absolute(item.dir),
      capture: true
    });
    const metadata = normalizePackMetadata(result.stdout, `${item.name} npm pack`);
    if (item.key === "threejson") assertThreejsonPackMetadata(metadata);
    console.log(`  ${metadata.filename} (${metadata.size} bytes, ${metadata.entryCount || metadata.files?.length || 0} files)`);
  }
  console.log(`\n全部 tarball 已写入：${destination}`);
  return destination;
}

function getPublishedPackageMetadata(name, version) {
  const result = runNpm([
    "view",
    `${name}@${version}`,
    "version",
    "dist.integrity",
    "dist.shasum",
    "--json",
    "--prefer-online"
  ], {
    capture: true,
    allowFailure: true
  });
  if (result.status !== 0) {
    const output = `${result.stderr || ""}\n${result.stdout || ""}`;
    if (/E404|404 Not Found|is not in this registry/i.test(output)) return null;
    throw new Error(`无法确认 ${name}@${version} 是否已发布：\n${output.trim()}`);
  }
  const parsedValue = parseJsonOutput(result.stdout, `${name}@${version} npm view`);
  const parsed = Array.isArray(parsedValue) ? parsedValue.at(-1) : parsedValue;
  if (typeof parsed === "string") return { version: parsed };
  return {
    version: parsed?.version || version,
    integrity: parsed?.["dist.integrity"] || parsed?.dist?.integrity,
    shasum: parsed?.["dist.shasum"] || parsed?.dist?.shasum
  };
}

async function confirmPublish(flags, plan) {
  console.log("\n将按依赖顺序发布：");
  const actionLabels = {
    publish: "发布",
    "reuse-assets": "assets 未变，复用已发布版本",
    resume: "断点续发，已验证内容一致"
  };
  for (const item of plan) {
    console.log(`  ${item.name}@${item.version}（${actionLabels[item.action] || item.action}）`);
  }
  if (flags["dry-run"]) return;
  if (flags.yes) return;
  const answer = await ask("输入 PUBLISH 确认向 npm 发布");
  if (answer !== "PUBLISH") throw new Error("已取消发布。");
}

function parsePositiveSeconds(value, fallback, label) {
  if (value == null || value === "") return fallback;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`${label} 必须是大于 0 的秒数。`);
  return seconds;
}

async function waitForPublishedPackage(name, version, { timeoutMs = 60_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    const metadata = getPublishedPackageMetadata(name, version);
    if (metadata) return metadata;
    if (Date.now() >= deadline) break;
    await wait(Math.max(0, Math.min(intervalMs, deadline - Date.now())));
  } while (Date.now() <= deadline);
  throw new Error(`npm registry 尚未提供 ${name}@${version}；请稍后使用 --resume 重试发布。`);
}

async function requirePublishedRuntimeReady(version, flags = {}) {
  const timeoutSeconds = parsePositiveSeconds(
    flags["cdn-timeout"],
    DEFAULT_CDN_TIMEOUT_SECONDS,
    "--cdn-timeout"
  );
  console.log(`\n验证 npm registry 中的 threejson@${version} ...`);
  await waitForPublishedPackage("threejson", version, {
    timeoutMs: Math.min(timeoutSeconds * 1000, 60_000)
  });
  console.log(`验证固定 CDN runtime：${threejsonRuntimeCdnUrl(version)}`);
  const result = await waitForThreejsonRuntimeCdn(version, {
    timeoutMs: timeoutSeconds * 1000,
    onAttempt: ({ attempt, lastFailure }) => {
      console.log(`  等待 jsDelivr（第 ${attempt} 次：${lastFailure}）`);
    }
  });
  console.log(`固定 CDN runtime 已就绪（第 ${result.attempt} 次检查）。`);
}

async function commandPublish(flags = {}) {
  const state = requireValidReleaseState();
  const dryRun = Boolean(flags["dry-run"]);
  if (!dryRun) runNpm(["whoami"]);
  runNpm(["run", "generate:business-domain-manifest"]);

  const rootItem = PACKAGE_PLAN.find((item) => item.key === "threejson");
  const rootLocalMetadata = inspectLocalPackage(rootItem);
  assertThreejsonPackMetadata(rootLocalMetadata);

  const plan = PACKAGE_PLAN.map((item) => ({
    ...item,
    version: state.versions[item.versionGroup],
    action: "publish",
    publishedMetadata: null
  }));

  if (!dryRun) {
    for (const item of plan) {
      item.publishedMetadata = getPublishedPackageMetadata(item.name, item.version);
      item.action = resolveExistingPackageAction(item, item.publishedMetadata, {
        resume: Boolean(flags.resume)
      });
    }
    const conflicts = plan.filter((item) => item.action === "conflict");
    if (conflicts.length) {
      throw new Error(
        `以下版本已经存在于 npm，默认禁止覆盖或静默跳过：\n- ${conflicts.map((item) => `${item.name}@${item.version}`).join("\n- ")}\n` +
        "正常发布请先升级版本号；仅在确认属于同一次部分发布时使用 --resume。"
      );
    }
    for (const item of plan.filter((candidate) => candidate.action === "resume" || candidate.action === "reuse-assets")) {
      const localMetadata = item.key === "threejson" ? rootLocalMetadata : inspectLocalPackage(item);
      if (item.key === "threejson") assertThreejsonPackMetadata(localMetadata);
      assertMatchingPackageIntegrity(item, localMetadata, item.publishedMetadata);
    }
  }

  await confirmPublish(flags, plan);
  for (const item of plan) {
    if (item.action === "publish") {
      const args = ["publish"];
      if (item.name.startsWith("@")) args.push("--access", "public");
      if (item.version.includes("-")) args.push("--tag", String(flags.tag || "alpha"));
      if (dryRun) args.push("--dry-run");
      console.log(`\n发布 ${item.name}@${item.version}${dryRun ? "（dry-run）" : ""}`);
      runNpm(args, { cwd: absolute(item.dir) });
    } else {
      console.log(`\n跳过 ${item.name}@${item.version}（${item.action === "reuse-assets" ? "assets 版本未变" : "已安全断点续发"}）`);
    }

    if (item.key === "threejson" && !dryRun) {
      await requirePublishedRuntimeReady(item.version, flags);
    }
  }

  if (!dryRun) {
    console.log("\n所有 npm 包已发布，固定版本的 threejson/runtime 已在 jsDelivr 就绪。现在可以部署 Shower。 ");
  }
}

function gitOutput(args, options = {}) {
  const result = runGit(args, { ...options, capture: true });
  return String(result.stdout || "").trim();
}

function requireCleanReleaseCommit(expectedVersion) {
  if (gitOutput(["rev-parse", "--is-inside-work-tree"]) !== "true") {
    throw new Error("当前目录不是 Git 工作区，无法创建发布 tag。");
  }
  const status = gitOutput(["status", "--porcelain", "--untracked-files=normal"]);
  if (status) {
    throw new Error("创建发布 tag 前必须提交全部版本与代码变更，保持工作区干净。");
  }
  const headManifest = parseJsonOutput(gitOutput(["show", "HEAD:package.json"]), "HEAD:package.json");
  if (headManifest.version !== expectedVersion) {
    throw new Error(`HEAD 中的 threejson 版本为 ${headManifest.version}，当前版本为 ${expectedVersion}。`);
  }
  return gitOutput(["rev-parse", "HEAD"]);
}

async function verifyPublishedReleaseMatchesWorkspace(state) {
  const plan = PACKAGE_PLAN.map((item) => ({
    ...item,
    version: state.versions[item.versionGroup]
  }));
  for (const item of plan) {
    const publishedMetadata = getPublishedPackageMetadata(item.name, item.version);
    if (!publishedMetadata) throw new Error(`${item.name}@${item.version} 尚未发布，不能创建发布 tag。`);
    const localMetadata = inspectLocalPackage(item);
    if (item.key === "threejson") assertThreejsonPackMetadata(localMetadata);
    assertMatchingPackageIntegrity(item, localMetadata, publishedMetadata);
  }
}

async function commandTag(flags = {}) {
  const state = requireValidReleaseState();
  const head = requireCleanReleaseCommit(state.versions.threejson);
  await verifyPublishedReleaseMatchesWorkspace(state);
  await requirePublishedRuntimeReady(state.versions.threejson, flags);

  const tagName = String(flags["tag-name"] || `v${state.versions.threejson}`);
  runGit(["check-ref-format", `refs/tags/${tagName}`]);
  const existing = runGit(["rev-list", "-n", "1", `refs/tags/${tagName}`], {
    capture: true,
    allowFailure: true
  });
  if (existing.status === 0) {
    const taggedCommit = String(existing.stdout || "").trim();
    if (taggedCommit !== head) {
      throw new Error(`Git tag ${tagName} 已指向其他提交 ${taggedCommit}。`);
    }
    console.log(`Git tag ${tagName} 已存在并正确指向当前提交。`);
  } else {
    if (!flags.yes) {
      const answer = await ask(`输入 TAG 确认在当前提交创建 ${tagName}`);
      if (answer !== "TAG") throw new Error("已取消创建 Git tag。");
    }
    runGit(["tag", "-a", tagName, "-m", `ThreeJSON ${state.versions.threejson}`]);
    console.log(`已创建本地 annotated tag：${tagName}`);
  }

  if (flags.push) {
    const remote = String(flags.remote || "origin");
    if (!flags.yes) {
      const answer = await ask(`输入 PUSH_TAG 确认推送 ${tagName} 到 ${remote}`);
      if (answer !== "PUSH_TAG") throw new Error("已取消推送 Git tag；本地 tag 保留。 ");
    }
    runGit(["push", remote, `refs/tags/${tagName}`]);
    console.log(`已推送 Git tag：${remote}/${tagName}`);
  } else {
    console.log(`尚未推送 tag；需要时执行：git push origin refs/tags/${tagName}`);
  }
}

async function commandAll(flags = {}) {
  if (flags["dry-run"]) {
    throw new Error("一键执行不接受 --dry-run；请分别使用 release:version 和 release:publish 的 --dry-run。");
  }
  await commandVersion(flags);
  commandTest();
  commandPack();
  await commandPublish(flags);
  console.log("\n一键发布不自动提交或打 Git tag。提交当前版本变更后，请运行 npm run release:tag。 ");
}

function printHelp() {
  console.log(`ThreeJSON npm 发布工具

用法：
  npm run release                 交互式菜单
  npm run release:version         同步升级 threejson、assets 和 packages 版本
  npm run release:test            发布前测试
  npm run release:pack            按发布清单生成 tarball
  npm run release:publish         按依赖顺序发布
  npm run release:tag             发布后创建可选 Git tag
  npm run release:all             版本升级 + 测试 + 打包 + 发布
  npm run release:check           只检查版本与依赖一致性

version 可选参数：
  --threejson <version> --packages <version> --assets <version>
  --bump-assets --dry-run

publish 可选参数：
  --tag alpha --cdn-timeout 180 --resume --dry-run --yes

tag 可选参数：
  --tag-name v0.1.0-alpha.10 --cdn-timeout 180 --push --remote origin --yes
`);
}

async function interactiveMenu() {
  console.log("\nThreeJSON npm 发布工具");
  console.log("  1. 版本号升级");
  console.log("  2. 发布前测试");
  console.log("  3. 打包全部 npm 包");
  console.log("  4. 发布全部 npm 包");
  console.log("  5. 一键执行（版本升级 → 测试 → 打包 → 发布）");
  console.log("  6. 验证发布并创建 Git tag");
  console.log("  0. 退出");
  const choice = await ask("请选择", "0");
  return ({ "1": "version", "2": "test", "3": "pack", "4": "publish", "5": "all", "6": "tag", "0": "exit" })[choice] || choice;
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const command = parsed.command || await interactiveMenu();
  if (command === "exit") return;
  if (command === "help" || command === "--help") return printHelp();
  if (command === "check") return requireValidReleaseState();
  if (command === "version") return commandVersion(parsed.flags);
  if (command === "test") return commandTest();
  if (command === "pack") return commandPack();
  if (command === "publish") return commandPublish(parsed.flags);
  if (command === "tag") return commandTag(parsed.flags);
  if (command === "all") return commandAll(parsed.flags);
  printHelp();
  throw new Error(`未知命令：${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\n发布流程终止：${error?.message || error}`);
    process.exitCode = 1;
  });
}

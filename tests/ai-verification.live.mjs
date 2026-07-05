/**
 * Optional live AI verification (requires tools/threejson-agent/setting.json with llm.apiKey).
 * Run: npm run verify:ai-live
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const shellPyDir = path.join(repoRoot, "tools", "threejson-agent", "shell", "py");
const settingPath = path.join(repoRoot, "tools", "threejson-agent", "setting.json");
const fixtureDir = path.join(__dirname, "fixtures", "ai-test");
const outDir = path.join(fixtureDir, "out");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

function runPy(args, label) {
  const r = spawnSync("python", ["-m", "threejson_agent", ...args], {
    cwd: shellPyDir,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 120_000
  });
  const combined = `${r.stdout || ""}\n${r.stderr || ""}`;
  if (r.status !== 0) {
    if (/AI request failed \(429\)|rate limit|429/.test(combined)) {
      console.warn(`SKIP (rate limit): ${label}`);
      return true;
    }
    fail(`${label}\n${combined}`);
    return false;
  }
  pass(label);
  return true;
}

console.log(`Node for bridge subprocess: ${spawnSync("node", ["-v"], { encoding: "utf8" }).stdout?.trim()}`);

if (!existsSync(settingPath)) {
  console.error(
    "Skip live verify: tools/threejson-agent/setting.json not found. Copy setting.example.json and set llm.apiKey."
  );
  process.exit(0);
}

const setting = JSON.parse(readFileSync(settingPath, "utf8"));
if (!String(setting.llm?.apiKey || "").trim()) {
  console.error("Skip live verify: llm.apiKey empty in setting.json.");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

const configArg = ["--config", settingPath];
const outGenerate = path.join(outDir, "live-generate.json");
const slotsFixture = path.join(fixtureDir, "scene-with-texture-slots.json");

console.log("Live AI verification (agent setting.json)…\n");

runPy(
  [
    ...configArg,
    "scene",
    "generate",
    "--prompt",
    "一个最小场景：单个蓝色立方体在地面上",
    "--no-agent",
    "-o",
    outGenerate
  ],
  "C2 live: scene generate --no-agent"
) &&
  runPy(
    [
      ...configArg,
      "texture",
      "plan",
      "-i",
      slotsFixture
    ],
    "C5 live: texture plan"
  );

if (process.exitCode) {
  console.error("\nLive verification finished with failures.");
} else {
  console.log("\nLive verification finished OK.");
}

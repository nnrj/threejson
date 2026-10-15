/** Build Cloud against offline local package artifacts in an isolated directory.
 * Never replaces the real Cloud node_modules, lockfile or dependency versions.
 * Run after rebuilding workers/syncing shared hosts. This is not a release test.
 */
import { cp, mkdir, mkdtemp, readdir, readFile, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cloud = path.resolve(root, "../threebox-cloud");
const out = path.join(root, "dist");
await mkdir(out, { recursive: true });
const stage = await mkdtemp(path.join(out, "cloud-local-packages-"));
const modules = path.join(stage, "node_modules"), packs = path.join(stage, "tarballs");
await mkdir(modules); await mkdir(packs);
const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
if (!existsSync(npm)) throw new Error("Cannot locate npm CLI next to Node. Run this script through npm exec or set npm_execpath.");
const sources = [root, ...["host-kit", "react-scene-agent", "scene-agent-kit", "media-kit", "audio-kit"].map(name => path.join(root, "packages", name))];
const replacements = new Set(await Promise.all(sources.map(async source => JSON.parse(await readFile(path.join(source, "package.json"), "utf8")).name)));
// Link existing third-party dependencies only. Cloud's installed versions win;
// missing optional media dependencies may use the ThreeJSON development install.
const linked = new Set();
for (const base of [path.join(cloud, "node_modules"), path.join(root, "node_modules")]) {
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const names = entry.name.startsWith("@") ? (await readdir(path.join(base, entry.name))).map(name => `${entry.name}/${name}`) : [entry.name];
    for (const name of names) {
      if (linked.has(name) || replacements.has(name)) continue;
      const destination = path.join(modules, name);
      await mkdir(path.dirname(destination), { recursive: true });
      await symlink(path.join(base, name), destination, process.platform === "win32" ? "junction" : "dir");
      linked.add(name);
    }
  }
}
for (const source of sources) {
  const packed = JSON.parse(execFileSync(process.execPath, [npm, "pack", source, "--ignore-scripts", "--offline", "--json", "--pack-destination", packs], { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }))[0];
  const destination = path.join(modules, packed.name);
  await mkdir(destination, { recursive: true });
  execFileSync("tar", ["-xf", path.join(packs, packed.filename), "-C", destination, "--strip-components", "1"]);
  console.log(`Local package: ${packed.name}`);
}
for (const name of ["src", "public", "index.html", "package.json", "tsconfig.json", "vite.config.ts"]) {
  const source = path.join(cloud, name);
  if (existsSync(source)) await cp(source, path.join(stage, name), { recursive: true });
}
const run = (name, script, args) => {
  console.log(name);
  execFileSync(process.execPath, [path.join(modules, script), ...args], { cwd: stage, stdio: "inherit" });
};
run("Cloud type check (local artifacts)", "typescript/bin/tsc", ["-b"]);
run("Cloud production build (local artifacts)", "vite/bin/vite.js", ["build"]);
console.log(`PASS: isolated Cloud build. Artifacts retained at ${stage}`);

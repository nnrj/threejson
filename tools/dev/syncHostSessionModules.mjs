// The static baseline must work without packages/. Publish exact copies for npm hosts.
// Keep new shared session modules canonical under scene-host/shared, and check for drift in CI.
import { readFile, writeFile } from "node:fs/promises";
export const HOST_SESSION_MODULES = ["sceneCardSession.js", "sceneViewportPool.js", "sceneCapabilities.js"];
export async function syncHostSessionModules({ check = false } = {}) {
  for (const name of HOST_SESSION_MODULES) {
    const source = new URL(`../scene-host/shared/js/${name}`, import.meta.url);
    const target = new URL(`../../packages/host-kit/js/${name}`, import.meta.url);
    const text = (await readFile(source, "utf8")).replace(/\r\n/g, "\n");
    if (check) {
      const copy = (await readFile(target, "utf8")).replace(/\r\n/g, "\n");
      if (text !== copy) throw new Error(`${name} differs: run node tools/dev/syncHostSessionModules.mjs`);
    } else await writeFile(target, text);
  }
}
if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  await syncHostSessionModules({ check: process.argv.includes("--check") });
}

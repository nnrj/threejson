/** Explicit opt-in real-provider checks; never part of npm test. */
import { readFile } from "node:fs/promises";
import { runSceneAi } from "../packages/scene-tools/js/ai.js";
import { runTextureFill } from "../packages/scene-tools/js/texture-fill.mjs";
const file = process.env.THREEJSON_LIVE_SETTINGS;
if (!file) {
  console.log("Not run: set THREEJSON_LIVE_SETTINGS explicitly to a private config. Live requests may incur charges.");
} else {
  const setting = JSON.parse(await readFile(file, "utf8"));
  const scene = await runSceneAi({ setting, prompt: "One blue cube on a floor. A minimal scene.", writeScene: false });
  if (!scene.ok) throw new Error("Live generation did not complete.");
  const texture = await runTextureFill({ setting, sceneJsonString: scene.sceneJsonString, dryRun: true });
  console.log(JSON.stringify({ generation: scene.ok, texturePlan: texture.ok, noFilesWritten: true }));
}

import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateSceneJsonFile } from "../../core/util/nodeSceneFile.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** 当前约定：`--source` / `--output` 相对项目根目录解析（本脚本在 `examples/script/`）。 */
const projectRoot = path.join(__dirname, "../..");

const args = process.argv.slice(2);
const promptArg = args.find((arg) => arg.startsWith("--prompt="));
const providerArg = args.find((arg) => arg.startsWith("--provider="));
const apiKeyArg = args.find((arg) => arg.startsWith("--apiKey="));
const modelArg = args.find((arg) => arg.startsWith("--model="));
const sourceArg = args.find((arg) => arg.startsWith("--source="));
const outputArg = args.find((arg) => arg.startsWith("--output="));

const prompt = promptArg ? promptArg.slice("--prompt=".length) : "";
const provider = providerArg ? providerArg.slice("--provider=".length) : "chatgpt";
const apiKeyFromArg = apiKeyArg ? apiKeyArg.slice("--apiKey=".length) : "";
const model = modelArg ? modelArg.slice("--model=".length) : "";
const sourceFile = sourceArg ? sourceArg.slice("--source=".length) : "./assets/json/tutorial/track-05/05-01-ai-scene.json";
const outputFile = outputArg ? outputArg.slice("--output=".length) : "./assets/json/aiDemoOutputScene.json";

if (!prompt.trim()) {
  console.error("Missing --prompt.");
  console.error("Example:");
  console.error('node examples/script/ai-update-scene.mjs --prompt="增加一条主干道和两个仓库"');
  process.exit(1);
}

const apiKey = apiKeyFromArg || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
if (!apiKey) {
  console.error("Missing apiKey. Provide --apiKey=... or env OPENAI_API_KEY/DEEPSEEK_API_KEY.");
  process.exit(1);
}

const sourcePath = path.isAbsolute(sourceFile) ? path.normalize(sourceFile) : path.resolve(projectRoot, sourceFile);
const outputPath = path.isAbsolute(outputFile) ? path.normalize(outputFile) : path.resolve(projectRoot, outputFile);

try {
  await copyFile(sourcePath, outputPath);
  const result = await updateSceneJsonFile(prompt, outputPath, {
    provider,
    apiKey,
    model: model || undefined
  });

  const boxCount = JSON.parse(result.sceneJsonString)?.worldInfo?.boxModelList?.length || 0;
  console.log("AI scene update completed.");
  console.log(`Provider: ${provider}`);
  console.log(`Output file: ${result.path}`);
  console.log(`boxModelList count: ${boxCount}`);
} catch (error) {
  console.error("AI scene update failed:");
  console.error(error);
  process.exit(1);
}

/**
 * Node-only scene file read/write + AI update. External tools only (not in core/index exports).
 */
import path from "node:path";
import {
  parseSceneJsonString,
  requestUpdatedSceneJsonString
} from "../ai/sceneAiService.js";

async function readSceneFile(sceneFilePath) {
  const fs = await import("node:fs/promises");
  return fs.readFile(sceneFilePath, "utf-8");
}

function prettyJson(sceneObj) {
  return JSON.stringify(sceneObj, null, 2);
}

function extractObjectLiteralFromJs(moduleCode) {
  const eqIndex = moduleCode.indexOf("=");
  if (eqIndex < 0) {
    throw new Error("Cannot find '=' in JS scene file.");
  }
  const braceStart = moduleCode.indexOf("{", eqIndex);
  if (braceStart < 0) {
    throw new Error("Cannot find JSON object start in JS scene file.");
  }

  let depth = 0;
  let endIndex = -1;
  for (let i = braceStart; i < moduleCode.length; i += 1) {
    const ch = moduleCode[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }
  }
  if (endIndex < 0) {
    throw new Error("Cannot find JSON object end in JS scene file.");
  }
  return moduleCode.slice(braceStart, endIndex + 1);
}

function parseSceneFromFileContent(fileContent, ext) {
  if (ext === ".json") {
    return parseSceneJsonString(fileContent);
  }
  if (ext === ".js") {
    const objectLiteral = extractObjectLiteralFromJs(fileContent);
    return parseSceneJsonString(objectLiteral);
  }
  throw new Error(`Unsupported file extension "${ext}". Use .json or .js`);
}

function rebuildJsSceneModule(updatedSceneObj, originalJsContent) {
  const constMatch = originalJsContent.match(/const\s+([A-Za-z_$][\w$]*)\s*=/);
  const exportMatch = originalJsContent.match(/export\s*\{[\s\S]*?\};?/);
  const constName = constMatch ? constMatch[1] : "sceneInfo";
  const exportBlock = exportMatch ? exportMatch[0] : `export {\n  ${constName}\n};`;
  return `const ${constName} = ${prettyJson(updatedSceneObj)};\n\n${exportBlock}\n`;
}

async function writeSceneFile(sceneFilePath, content) {
  const fs = await import("node:fs/promises");
  await fs.writeFile(sceneFilePath, content, "utf-8");
}

/**
 * @param {string} prompt
 * @param {string} sceneFilePath
 * @param {object} [options={}]
 * @returns {Promise<{ path: string, sceneJsonString: string }>}
 */
export async function updateSceneJsonFile(prompt, sceneFilePath, options = {}) {
  if (!prompt || !String(prompt).trim()) {
    throw new Error("prompt is required.");
  }
  if (!sceneFilePath || !String(sceneFilePath).trim()) {
    throw new Error("sceneFilePath is required.");
  }

  const ext = path.extname(sceneFilePath).toLowerCase();
  const originalContent = await readSceneFile(sceneFilePath);
  const originalSceneObj = parseSceneFromFileContent(originalContent, ext);
  const updatedSceneJsonString = await requestUpdatedSceneJsonString(
    prompt,
    prettyJson(originalSceneObj),
    options
  );
  const updatedSceneObj = parseSceneJsonString(updatedSceneJsonString);

  if (ext === ".json") {
    await writeSceneFile(sceneFilePath, prettyJson(updatedSceneObj));
  } else {
    const rebuiltJsModule = rebuildJsSceneModule(updatedSceneObj, originalContent);
    await writeSceneFile(sceneFilePath, rebuiltJsModule);
  }

  return {
    path: sceneFilePath,
    sceneJsonString: prettyJson(updatedSceneObj)
  };
}

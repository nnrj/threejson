/**
 * Texture-plan prompts for chat models (English only for output quality).
 */

const TEXTURE_PLAN_SCHEMA = `
You output a single JSON object describing texture generation tasks for a ThreeJSON scene.

Output shape (strict):
{
  "tasks": [
    {
      "pointer": string,
      "prompt": string,
      "size": string (optional, e.g. "1024x1024"),
      "mimeType": string (optional, e.g. "image/png")
    }
  ]
}

Rules for "pointer":
- Use JSON Pointer (RFC 6901): path segments separated by "/", optional leading "/".
- Each pointer MUST target a "textureUrl" leaf that already exists or will be created on a material object.
  Valid parents are "material" or entries inside a "materials" array under BoxModel nodes under worldInfo.boxModelList (including nested joins, inters, holes arrays).
- Example: "/worldInfo/boxModelList/0/material/textureUrl"
- Example: "/worldInfo/boxModelList/2/materials/1/textureUrl"
- Example nested: "/worldInfo/boxModelList/0/joins/1/material/textureUrl"

Rules for "prompt":
- Describe a seamless/tileable texture suitable for 3D UV mapping when the surface is large (floors, walls).
- Mention view angle when relevant (e.g. "top-down" for floors).
- Keep prompts compact; no quotes that break JSON.

Do not include tasks for glass or fully transparent materials unless the user explicitly asks.

Output requirement:
- Return ONLY one JSON object. No Markdown fences. No commentary before or after.
`;

/** @param {string} validPointersBlock  multi-line list of allowed pointers */
function buildTexturePlanSystemPrompt(validPointersBlock) {
  return [
    "You are a texture planning assistant for the ThreeJSON engine.",
    "You read a scene JSON and a user hint, then propose image-generation prompts for material.textureUrl slots.",
    TEXTURE_PLAN_SCHEMA.trim(),
    "Candidate textureUrl locations in this scene (you may use only these pointers; do not invent paths):",
    validPointersBlock.trim()
  ].join("\n\n");
}

/**
 * @param {object} sceneObj
 * @param {string} userHint
 */
function buildTexturePlanUserContent(sceneObj, userHint) {
  const sceneJson = JSON.stringify(sceneObj, null, 2);
  return [
    `User hint for style/content:\n${String(userHint || "").trim() || "(none — infer sensible PBR-friendly textures from names and material types.)"}`,
    "",
    "Current scene JSON:",
    sceneJson
  ].join("\n");
}

export { TEXTURE_PLAN_SCHEMA, buildTexturePlanSystemPrompt, buildTexturePlanUserContent };
